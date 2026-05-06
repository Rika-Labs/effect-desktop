import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Option, Queue, Schema, Stream } from "effect"

import {
  makePermissionRegistry,
  PermissionActor,
  PermissionContext,
  type NormalizedCapability
} from "./permission-registry.js"
import { makeResourceRegistry, type ResourceRegistryApi } from "./resources.js"
import {
  makeWorker,
  WorkerCapabilityNotHeldError,
  WorkerChannelError,
  WorkerCrashedError,
  type WorkerAdapter,
  type WorkerApi,
  type WorkerError,
  type WorkerRuntime
} from "./worker.js"

const EchoIn = Schema.Struct({ text: Schema.String })
const EchoOut = Schema.Struct({ echoed: Schema.String })

const actor = new PermissionActor({ kind: "app", id: "app-main" })
const context = new PermissionContext({ actor, traceId: "trace-worker" })
const filesystemReadCapability: NormalizedCapability = {
  kind: "filesystem.read",
  roots: ["/tmp"],
  audit: "always"
}

test("Worker validates channel send and receive through schemas", async () => {
  const runtime = await makeFakeRuntime()
  const fixture = await makeFixture(makeFakeAdapter(runtime), [filesystemReadCapability])
  const handle = await Effect.runPromise(
    fixture.service.spawn({
      script: "./worker.ts",
      ownerScope: "scope-main",
      inputSchema: EchoIn,
      outputSchema: EchoOut,
      context,
      capabilities: [filesystemReadCapability]
    })
  )

  await Effect.runPromise(handle.send({ text: "hello" }))
  await Effect.runPromise(runtime.emit({ echoed: "hello" }))
  const messages = await Effect.runPromise(handle.messages.pipe(Stream.take(1), Stream.runCollect))

  expect(runtime.sent).toEqual([{ text: "hello" }])
  expect(Array.from(messages)).toEqual([{ echoed: "hello" }])
})

test("Worker closes with the owning resource scope", async () => {
  const runtime = await makeFakeRuntime()
  const fixture = await makeFixture(makeFakeAdapter(runtime), [filesystemReadCapability])

  await Effect.runPromise(
    fixture.service.spawn({
      script: "./worker.ts",
      ownerScope: "scope-main",
      inputSchema: EchoIn,
      outputSchema: EchoOut,
      context,
      capabilities: [filesystemReadCapability]
    })
  )
  await Effect.runPromise(fixture.registry.closeScope("scope-main"))

  expect(runtime.shutdowns).toBe(1)
})

test("Worker list returns live snapshots and removes closed workers", async () => {
  const runtime = await makeFakeRuntime()
  const fixture = await makeFixture(makeFakeAdapter(runtime), [filesystemReadCapability], {
    nowStart: 10
  })
  const handle = await Effect.runPromise(
    fixture.service.spawn({
      script: "./listed-worker.ts",
      ownerScope: "scope-main",
      inputSchema: EchoIn,
      outputSchema: EchoOut,
      context,
      capabilities: [filesystemReadCapability]
    })
  )

  const listed = await Effect.runPromise(fixture.service.list())
  await Effect.runPromise(handle.close)
  const afterClose = await Effect.runPromise(fixture.service.list())

  expect(listed.map((worker) => worker.script)).toEqual(["./listed-worker.ts"])
  expect(listed[0]?.resourceId).toBe(handle.resource.id)
  expect(listed[0]?.capabilities).toEqual([filesystemReadCapability])
  expect(afterClose).toEqual([])
})

test("Worker list normalizes fractional uptime before snapshot construction", async () => {
  const runtime = await makeFakeRuntime()
  const fixture = await makeFixture(makeFakeAdapter(runtime), [], {
    nowStart: 10.25
  })
  await Effect.runPromise(
    fixture.service.spawn({
      script: "./fractional-clock-worker.ts",
      ownerScope: "scope-main",
      inputSchema: EchoIn,
      outputSchema: EchoOut,
      context
    })
  )

  const listed = await Effect.runPromise(fixture.service.list())

  expect(listed[0]?.uptimeMs).toBe(1)
})

test("Worker rejects missing capabilities as CapabilityNotHeld before adapter spawn", async () => {
  let spawnCalls = 0
  const runtime = await makeFakeRuntime()
  const fixture = await makeFixture({
    spawn: () => {
      spawnCalls += 1
      return Effect.succeed(runtime)
    }
  })

  const exit = await Effect.runPromiseExit(
    fixture.service.spawn({
      script: "./worker.ts",
      ownerScope: "scope-main",
      inputSchema: EchoIn,
      outputSchema: EchoOut,
      context,
      capabilities: [filesystemReadCapability]
    })
  )

  expect(spawnCalls).toBe(0)
  expectFailure(exit, WorkerCapabilityNotHeldError)
})

test("Worker reports crashes on the messages error channel", async () => {
  const runtime = await makeFakeRuntime()
  const fixture = await makeFixture(makeFakeAdapter(runtime), [filesystemReadCapability])
  const handle = await Effect.runPromise(
    fixture.service.spawn({
      script: "./worker.ts",
      ownerScope: "scope-main",
      inputSchema: EchoIn,
      outputSchema: EchoOut,
      context,
      capabilities: [filesystemReadCapability]
    })
  )

  await Effect.runPromise(runtime.crash(1))
  const exit = await Effect.runPromiseExit(handle.messages.pipe(Stream.runCollect))

  expectFailure(exit, WorkerCrashedError)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(WorkerCrashedError)
    if (failure?.error instanceof WorkerCrashedError) {
      expect(Option.getOrUndefined(failure.error.resourceId)).toBe(handle.resource.id)
    }
  }
})

test("Worker disposes resource and releases budget when runtime exits by itself", async () => {
  const runtime = await makeFakeRuntime()
  const replacement = await makeFakeRuntime()
  const runtimes = [runtime, replacement]
  const fixture = await makeFixture(
    {
      spawn: () => {
        const next = runtimes.shift()
        return next === undefined
          ? Effect.fail(
              new WorkerChannelError({
                operation: "Worker.spawn",
                field: "transport",
                script: "./worker.ts",
                message: "missing fake runtime",
                cause: Option.none()
              })
            )
          : Effect.succeed(next)
      }
    },
    [filesystemReadCapability],
    { maxConcurrent: 1 }
  )

  const handle = await Effect.runPromise(
    fixture.service.spawn({
      script: "./worker.ts",
      ownerScope: "scope-main",
      inputSchema: EchoIn,
      outputSchema: EchoOut,
      context,
      capabilities: [filesystemReadCapability]
    })
  )
  await Effect.runPromise(runtime.complete())
  await waitUntil(async () => {
    const snapshot = await Effect.runPromise(fixture.registry.list())
    return snapshot.entries.length === 0
  })
  const nextHandle = await Effect.runPromise(
    fixture.service.spawn({
      script: "./worker.ts",
      ownerScope: "scope-main",
      inputSchema: EchoIn,
      outputSchema: EchoOut,
      context,
      capabilities: [filesystemReadCapability]
    })
  )

  expect(nextHandle.resource.id).not.toBe(handle.resource.id)
})

test("Worker validates malformed sends before transmission", async () => {
  const runtime = await makeFakeRuntime()
  const fixture = await makeFixture(makeFakeAdapter(runtime), [filesystemReadCapability])
  const handle = await Effect.runPromise(
    fixture.service.spawn({
      script: "./worker.ts",
      ownerScope: "scope-main",
      inputSchema: EchoIn,
      outputSchema: EchoOut,
      context,
      capabilities: [filesystemReadCapability]
    })
  )

  const exit = await Effect.runPromiseExit(handle.send({ nope: true } as never))

  expect(runtime.sent).toEqual([])
  expectFailure(exit, WorkerChannelError)
})

test("Worker validates malformed outputs on the messages stream", async () => {
  const runtime = await makeFakeRuntime()
  const fixture = await makeFixture(makeFakeAdapter(runtime), [filesystemReadCapability])
  const handle = await Effect.runPromise(
    fixture.service.spawn({
      script: "./worker.ts",
      ownerScope: "scope-main",
      inputSchema: EchoIn,
      outputSchema: EchoOut,
      context,
      capabilities: [filesystemReadCapability]
    })
  )

  await Effect.runPromise(runtime.emit({ nope: true }))
  const exit = await Effect.runPromiseExit(handle.messages.pipe(Stream.take(1), Stream.runCollect))

  expectFailure(exit, WorkerChannelError)
})

test("Worker disposes two workers in deterministic newest-first scope order", async () => {
  const disposals: string[] = []
  const first = await makeFakeRuntime("first", disposals)
  const second = await makeFakeRuntime("second", disposals)
  const runtimes = [first, second]
  const fixture = await makeFixture(
    {
      spawn: () => {
        const runtime = runtimes.shift()
        if (runtime === undefined) {
          return Effect.fail(
            new WorkerChannelError({
              operation: "Worker.spawn",
              field: "transport",
              script: "./worker.ts",
              message: "missing fake runtime",
              cause: Option.none()
            })
          )
        }
        return Effect.succeed(runtime)
      }
    },
    [filesystemReadCapability],
    { nowStart: 10 }
  )

  await Effect.runPromise(
    fixture.service.spawn({
      script: "./first.ts",
      ownerScope: "scope-main",
      inputSchema: EchoIn,
      outputSchema: EchoOut,
      context,
      capabilities: [filesystemReadCapability]
    })
  )
  await Effect.runPromise(
    fixture.service.spawn({
      script: "./second.ts",
      ownerScope: "scope-main",
      inputSchema: EchoIn,
      outputSchema: EchoOut,
      context,
      capabilities: [filesystemReadCapability]
    })
  )
  await Effect.runPromise(fixture.registry.closeScope("scope-main"))

  expect(disposals).toEqual(["second", "first"])
})

test("Worker default Bun adapter sends, receives, and closes a real worker", async () => {
  const file = new File(
    [
      `self.onmessage = (event) => {
        if (event.data?._tag === "Shutdown") {
          close()
        } else {
          postMessage({ echoed: event.data.text })
        }
      }`
    ],
    "effect-desktop-worker-test.ts",
    { type: "application/typescript" }
  )
  const script = URL.createObjectURL(file)
  const fixture = await makeFixture(undefined, [], { gracefulShutdownMs: 0 })

  try {
    const handle = await Effect.runPromise(
      fixture.service.spawn({
        script,
        ownerScope: "scope-main",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context
      })
    )

    await Effect.runPromise(handle.send({ text: "hello" }))
    const messages = await Effect.runPromise(
      handle.messages.pipe(Stream.take(1), Stream.runCollect)
    )
    await Effect.runPromise(handle.close)

    expect(Array.from(messages)).toEqual([{ echoed: "hello" }])
  } finally {
    URL.revokeObjectURL(script)
  }
})

interface Fixture {
  readonly service: WorkerApi
  readonly registry: ResourceRegistryApi
}

const makeFixture = async (
  adapter?: WorkerAdapter,
  allowedCapabilities: readonly NormalizedCapability[] = [],
  options: {
    readonly gracefulShutdownMs?: number
    readonly maxConcurrent?: number
    readonly nowStart?: number
  } = {}
): Promise<Fixture> => {
  let now = options.nowStart ?? 1
  const registry = await Effect.runPromise(
    makeResourceRegistry({
      now: () => now++,
      nextId: (timestamp) => `resource-${timestamp}` as never
    })
  )
  const permissions = await Effect.runPromise(makePermissionRegistry({ traceId: () => "trace" }))
  for (const capability of allowedCapabilities) {
    await Effect.runPromise(
      permissions.declare(capability, { actor, source: "worker-test", effect: "allow" })
    )
  }
  const service = await Effect.runPromise(
    makeWorker(registry, permissions, {
      now: () => now++,
      ...(adapter === undefined ? {} : { adapter }),
      ...(options.maxConcurrent === undefined
        ? {}
        : { budgets: { maxConcurrent: options.maxConcurrent } }),
      ...(options.gracefulShutdownMs === undefined
        ? {}
        : { gracefulShutdownMs: options.gracefulShutdownMs })
    })
  )

  return { service, registry }
}

interface FakeWorkerRuntime extends WorkerRuntime {
  readonly sent: unknown[]
  readonly shutdowns: number
  readonly complete: () => Effect.Effect<void, WorkerError, never>
  readonly emit: (message: unknown) => Effect.Effect<void, WorkerError, never>
  readonly crash: (exitCode: number) => Effect.Effect<void, WorkerError, never>
}

const makeFakeRuntime = async (
  disposalName?: string,
  disposals: string[] = []
): Promise<FakeWorkerRuntime> => {
  const queue = await Effect.runPromise(Queue.unbounded<unknown, WorkerError | Cause.Done>())
  const exit = await Effect.runPromise(Deferred.make<void, WorkerError>())
  const sent: unknown[] = []
  let shutdowns = 0

  return {
    sent,
    get shutdowns() {
      return shutdowns
    },
    send: (message) =>
      Effect.sync(() => {
        sent.push(message)
      }),
    messages: Stream.fromQueue(queue),
    exit: Deferred.await(exit),
    shutdown: Effect.sync(() => {
      shutdowns += 1
      if (disposalName !== undefined) {
        disposals.push(disposalName)
      }
    }).pipe(
      Effect.andThen(Queue.shutdown(queue)),
      Effect.andThen(Deferred.succeed(exit, undefined)),
      Effect.asVoid
    ),
    complete: () => Queue.end(queue).pipe(Effect.andThen(Deferred.succeed(exit, undefined))),
    emit: (message) => Queue.offer(queue, message),
    crash: (exitCode) => {
      const error = new WorkerCrashedError({
        operation: "Worker.messages",
        script: "./worker.ts",
        resourceId: Option.none(),
        exitCode: Option.some(exitCode),
        signal: Option.none(),
        lastError: Option.none()
      })
      return Queue.fail(queue, error).pipe(Effect.andThen(Deferred.fail(exit, error)))
    }
  }
}

const waitUntil = async (predicate: () => Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("condition was not met")
}

const makeFakeAdapter = (runtime: WorkerRuntime): WorkerAdapter => ({
  spawn: () => Effect.succeed(runtime)
})

const expectFailure = <E>(
  exit: Exit.Exit<unknown, E>,
  expected: abstract new (...args: never[]) => E
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(expected)
  }
}
