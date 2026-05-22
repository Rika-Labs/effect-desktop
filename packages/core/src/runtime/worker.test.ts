import { expect, test } from "bun:test"
import {
  Cause,
  Clock,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Option,
  Queue,
  Schedule,
  Schema,
  Stream
} from "effect"

import {
  makeExecutionInspectorCollector,
  type ExecutionInspectorCollectorApi
} from "./inspector-events.js"
import {
  makePermissionRegistry,
  PermissionActor,
  type NormalizedCapability
} from "./permission-registry.js"
import type { ResourceOwnerApi } from "./resource-owner.js"
import { makeResourceId, makeResourceRegistry } from "./resources.js"
import {
  makeWorker,
  WorkerCapabilityNotHeldError,
  WorkerChannelError,
  WorkerCrashedError,
  WorkerInvalidArgumentError,
  WorkerResourceBusyError,
  WorkerSnapshot,
  WorkerStaleHandleError,
  WorkerUnsupportedError,
  type WorkerAdapter,
  type WorkerError,
  type WorkerRuntime
} from "./worker.js"

const EchoIn = Schema.Struct({ text: Schema.String })
const EchoOut = Schema.Struct({ echoed: Schema.String })

const TEST_OWNER: ResourceOwnerApi = Object.freeze({
  kind: "test",
  scopeId: "scope-main",
  actor: new PermissionActor({ kind: "resource", id: "scope-main" }),
  attributes: Object.freeze({ scopeId: "scope-main" })
})
const context = { traceId: "trace-worker" }
const filesystemReadCapability: NormalizedCapability = {
  kind: "filesystem.read",
  roots: ["/tmp"],
  audit: "always"
}
const id = makeResourceId

class WaitUntilError extends Data.TaggedError("WaitUntilError")<{
  readonly message: string
  readonly cause: Option.Option<unknown>
}> {}

test("Worker validates channel send and receive through schemas", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* makeFakeRuntime()
      const fixture = yield* makeFixture(makeFakeAdapter(runtime), [filesystemReadCapability])
      const handle = yield* fixture.service.spawn({
        script: "./worker.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })

      yield* handle.send({ text: "hello" })
      yield* runtime.emit({ echoed: "hello" })
      const messages = yield* handle.messages.pipe(Stream.take(1), Stream.runCollect)

      expect(runtime.sent).toEqual([{ text: "hello" }])
      expect(Array.from(messages)).toEqual([{ echoed: "hello" }])
    })
  ))

test("Worker rejects generated resource ids that violate non-empty contract", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* makeFakeRuntime()
      const registry = yield* makeResourceRegistry({
        now: () => 1,
        // @ts-expect-error intentionally invalid generated id exercises registry validation.
        nextId: () => ""
      })
      const permissions = yield* makePermissionRegistry({ traceId: () => "trace" })

      const service = yield* makeWorker(registry, permissions, TEST_OWNER, {
        adapter: makeFakeAdapter(runtime)
      })
      const exit = yield* Effect.exit(
        service.spawn({
          script: "./worker.ts",
          inputSchema: EchoIn,
          outputSchema: EchoOut,
          context
        })
      )
      const listed = yield* service.list()

      expectFailure(exit, WorkerInvalidArgumentError)
      expect(listed).toEqual([])
    })
  ))

test("Worker closes with the owning resource scope", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* makeFakeRuntime()
      const fixture = yield* makeFixture(makeFakeAdapter(runtime), [filesystemReadCapability])

      yield* fixture.service.spawn({
        script: "./worker.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })
      yield* fixture.registry.closeScope("scope-main")

      expect(runtime.shutdowns).toBe(1)
    })
  ))

test("Worker owner-scope close interrupts unfinished exit observers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* makeFakeRuntime(undefined, [], false)
      const fixture = yield* makeFixture(makeFakeAdapter(runtime), [filesystemReadCapability])

      yield* fixture.service.spawn({
        script: "./hanging-exit-worker.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })

      const exit = yield* Effect.exit(fixture.registry.closeScope("scope-main"))
      const snapshot = yield* fixture.registry.list()

      expect(Exit.isSuccess(exit)).toBe(true)
      expect(runtime.shutdowns).toBe(1)
      expect(snapshot.entries).toEqual([])
    })
  ))

test("Worker list returns live snapshots and removes closed workers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* makeFakeRuntime()
      const fixture = yield* makeFixture(makeFakeAdapter(runtime), [filesystemReadCapability], {
        nowStart: 10
      })
      const handle = yield* fixture.service.spawn({
        script: "./listed-worker.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })

      const listed = yield* fixture.service.list()
      yield* handle.close
      const afterClose = yield* fixture.service.list()

      expect(listed.map((worker) => worker.script)).toEqual(["./listed-worker.ts"])
      expect(listed[0]?.resourceId).toBe(handle.resource.id)
      expect(listed[0]?.capabilities).toEqual([filesystemReadCapability])
      expect(afterClose).toEqual([])
    })
  ))

test("WorkerSnapshot rejects malformed capability entries", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Schema.decodeUnknownEffect(WorkerSnapshot)({
          id: "worker-1",
          script: "./worker.ts",
          ownerScope: "scope-main",
          resourceId: "resource-1",
          status: "running",
          uptimeMs: 0,
          capabilities: [
            {
              kind: "filesystem.read",
              roots: [42],
              audit: "always"
            }
          ]
        })
      )

      expect(Exit.isFailure(exit)).toBe(true)
    })
  ))

test("Worker list normalizes fractional uptime before snapshot construction", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* makeFakeRuntime()
      const fixture = yield* makeFixture(makeFakeAdapter(runtime), [], {
        nowStart: 10,
        workerNowStart: 10.25
      })
      yield* fixture.service.spawn({
        script: "./fractional-clock-worker.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context
      })

      const listed = yield* fixture.service.list()

      expect(listed[0]?.uptimeMs).toBe(1)
    })
  ))

test("Worker list normalizes invalid uptime before snapshot construction", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidTimestamps = [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        -1,
        Number.MAX_SAFE_INTEGER + 1000
      ]

      for (const timestamp of invalidTimestamps) {
        const runtime = yield* makeFakeRuntime()
        const registry = yield* makeResourceRegistry({
          now: () => 1,
          nextId: () => id(`worker-${String(timestamp)}`)
        })
        const permissions = yield* makePermissionRegistry({ traceId: () => "trace" })
        const workerNow = [100, timestamp]
        const service = yield* makeWorker(registry, permissions, TEST_OWNER, {
          adapter: makeFakeAdapter(runtime),
          now: () => workerNow.shift() ?? timestamp
        })
        yield* service.spawn({
          script: "./invalid-clock-worker.ts",
          inputSchema: EchoIn,
          outputSchema: EchoOut,
          context
        })

        const listed = yield* service.list()

        expect(listed[0]?.uptimeMs).toBe(0)
      }
    })
  ))

test("Worker spawn failure timestamps fall back to the Effect Clock", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const timestamp = 1_715_001_345_000
      const inspector = yield* makeExecutionInspectorCollector()
      let spawnCalls = 0
      const runtime = yield* makeFakeRuntime()
      const fixture = yield* makeFixture(
        {
          spawn: () => {
            spawnCalls += 1
            return Effect.succeed(runtime)
          }
        },
        [],
        { inspector, now: () => Number.NaN }
      )
      const observed = yield* inspector.events.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true })
      )
      yield* Effect.yieldNow

      const exit = yield* Effect.exit(
        fixture.service
          .spawn({
            script: "./worker.ts",
            inputSchema: EchoIn,
            outputSchema: EchoOut,
            context,
            capabilities: [filesystemReadCapability]
          })
          .pipe(Effect.provideService(Clock.Clock, fixedClock(timestamp)))
      )
      const events = [...(yield* Fiber.join(observed))]

      expectFailure(exit, WorkerCapabilityNotHeldError)
      expect(spawnCalls).toBe(0)
      expect(events[0]?.status).toBe("failure")
      expect(events[0]?.timestamp).toBe(timestamp)
    })
  ))

test("Worker rejects missing capabilities as CapabilityNotHeld before adapter spawn", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let spawnCalls = 0
      const runtime = yield* makeFakeRuntime()
      const fixture = yield* makeFixture({
        spawn: () => {
          spawnCalls += 1
          return Effect.succeed(runtime)
        }
      })

      const exit = yield* Effect.exit(
        fixture.service.spawn({
          script: "./worker.ts",
          inputSchema: EchoIn,
          outputSchema: EchoOut,
          context,
          capabilities: [filesystemReadCapability]
        })
      )

      expect(spawnCalls).toBe(0)
      expectFailure(exit, WorkerCapabilityNotHeldError)
    })
  ))

test("Worker rejects malformed capabilities as invalid spawn input before permission checks", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let spawnCalls = 0
      const runtime = yield* makeFakeRuntime()
      const fixture = yield* makeFixture({
        spawn: () => {
          spawnCalls += 1
          return Effect.succeed(runtime)
        }
      })

      const exit = yield* Effect.exit(
        fixture.service.spawn({
          script: "./worker.ts",
          inputSchema: EchoIn,
          outputSchema: EchoOut,
          context,
          capabilities: [
            {
              kind: "filesystem.read",
              // @ts-expect-error intentionally malformed capability exercises runtime validation.
              roots: [42],
              audit: "always"
            }
          ]
        })
      )

      expect(spawnCalls).toBe(0)
      expectFailure(exit, WorkerInvalidArgumentError)
    })
  ))

test("Worker reports crashes on the messages error channel", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* makeFakeRuntime()
      const fixture = yield* makeFixture(makeFakeAdapter(runtime), [filesystemReadCapability])
      const handle = yield* fixture.service.spawn({
        script: "./worker.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })

      yield* runtime.crash(1)
      const exit = yield* Effect.exit(handle.messages.pipe(Stream.runCollect))

      expectFailure(exit, WorkerCrashedError)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(failure?.error).toBeInstanceOf(WorkerCrashedError)
        if (failure?.error instanceof WorkerCrashedError) {
          expect(Option.getOrUndefined(failure.error.resourceId)).toBe(handle.resource.id)
        }
      }
    })
  ))

test("Worker disposes resource and releases budget when runtime exits by itself", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* makeFakeRuntime()
      const replacement = yield* makeFakeRuntime()
      const runtimes = [runtime, replacement]
      const fixture = yield* makeFixture(
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

      const handle = yield* fixture.service.spawn({
        script: "./worker.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })
      yield* runtime.complete()
      yield* waitUntil(
        Effect.gen(function* () {
          const snapshot = yield* fixture.registry.list()
          return snapshot.entries.length === 0
        })
      )
      const nextHandle = yield* fixture.service.spawn({
        script: "./worker.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })

      expect(nextHandle.resource.id).not.toBe(handle.resource.id)
    })
  ))

test("Worker enforces the per-scope concurrent worker budget", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const first = yield* makeFakeRuntime()
      const second = yield* makeFakeRuntime()
      const runtimes = [first, second]
      let spawnCalls = 0
      const fixture = yield* makeFixture(
        {
          spawn: () => {
            spawnCalls += 1
            return Effect.succeed(runtimes.shift() ?? second)
          }
        },
        [filesystemReadCapability],
        { maxConcurrent: 1 }
      )

      const handle = yield* fixture.service.spawn({
        script: "./worker-one.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })
      const busy = yield* Effect.exit(
        fixture.service.spawn({
          script: "./worker-two.ts",
          inputSchema: EchoIn,
          outputSchema: EchoOut,
          context,
          capabilities: [filesystemReadCapability]
        })
      )
      yield* handle.close
      const otherScope = yield* fixture.service.spawn({
        script: "./worker-three.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })

      expectFailure(busy, WorkerResourceBusyError)
      expect(spawnCalls).toBe(2)
      expect(otherScope.resource.id).not.toBe(handle.resource.id)
    })
  ))

test("Worker releases the per-scope budget after adapter failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const replacement = yield* makeFakeRuntime()
      let spawnCalls = 0
      const fixture = yield* makeFixture(
        {
          spawn: () => {
            spawnCalls += 1
            return spawnCalls === 1
              ? Effect.fail(
                  new WorkerChannelError({
                    operation: "Worker.spawn",
                    field: "transport",
                    script: "./worker.ts",
                    message: "adapter failed",
                    cause: Option.none()
                  })
                )
              : Effect.succeed(replacement)
          }
        },
        [filesystemReadCapability],
        { maxConcurrent: 1 }
      )

      const failed = yield* Effect.exit(
        fixture.service.spawn({
          script: "./worker-one.ts",
          inputSchema: EchoIn,
          outputSchema: EchoOut,
          context,
          capabilities: [filesystemReadCapability]
        })
      )
      const handle = yield* fixture.service.spawn({
        script: "./worker-two.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })

      expectFailure(failed, WorkerChannelError)
      expect(spawnCalls).toBe(2)
      expect(handle.resource.id.length).toBeGreaterThan(0)
    })
  ))

test("Worker validates malformed sends before transmission", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* makeFakeRuntime()
      const fixture = yield* makeFixture(makeFakeAdapter(runtime), [filesystemReadCapability])
      const handle = yield* fixture.service.spawn({
        script: "./worker.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })

      const exit = yield* Effect.exit(handle.send({ nope: true }))

      expect(runtime.sent).toEqual([])
      expectFailure(exit, WorkerChannelError)
    })
  ))

test("Worker rejects negative graceful shutdown durations before adapter spawn", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let spawnCalls = 0
      const runtime = yield* makeFakeRuntime()
      const fixture = yield* makeFixture(
        {
          spawn: () => {
            spawnCalls += 1
            return Effect.succeed(runtime)
          }
        },
        [],
        { gracefulShutdownMs: -1 }
      )

      const exit = yield* Effect.exit(
        fixture.service.spawn({
          script: "./worker.ts",
          inputSchema: EchoIn,
          outputSchema: EchoOut,
          context
        })
      )
      const snapshot = yield* fixture.registry.list()

      expect(spawnCalls).toBe(0)
      expect(snapshot.entries).toEqual([])
      expectFailure(exit, WorkerInvalidArgumentError)
    })
  ))

test("Worker rejects malformed channel schemas before adapter spawn", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly inputSchema: unknown
        readonly outputSchema: unknown
      }> = [
        { inputSchema: undefined, outputSchema: EchoOut },
        { inputSchema: EchoIn, outputSchema: undefined }
      ]

      for (const workerOptions of cases) {
        let spawnCalls = 0
        const runtime = yield* makeFakeRuntime()
        const fixture = yield* makeFixture({
          spawn: () => {
            spawnCalls += 1
            return Effect.succeed(runtime)
          }
        })

        const exit = yield* Effect.exit(
          fixture.service.spawn({
            script: "./worker.ts",
            inputSchema: workerOptions.inputSchema,
            outputSchema: workerOptions.outputSchema,
            context
          })
        )
        const snapshot = yield* fixture.registry.list()

        expect(spawnCalls).toBe(0)
        expect(snapshot.entries).toEqual([])
        expectFailure(exit, WorkerInvalidArgumentError)
      }
    })
  ))

test("Worker send rejects handles after close", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* makeFakeRuntime()
      const fixture = yield* makeFixture(makeFakeAdapter(runtime), [filesystemReadCapability])
      const handle = yield* fixture.service.spawn({
        script: "./worker.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })
      yield* handle.close

      const exit = yield* Effect.exit(handle.send({ text: "after-close" }))

      expect(runtime.sent).toEqual([])
      expectFailure(exit, WorkerStaleHandleError)
    })
  ))

test("Worker send rejects handles after owner scope close", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* makeFakeRuntime()
      const fixture = yield* makeFixture(makeFakeAdapter(runtime), [filesystemReadCapability])
      const handle = yield* fixture.service.spawn({
        script: "./worker.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })
      yield* fixture.registry.closeScope("scope-main")

      const exit = yield* Effect.exit(handle.send({ text: "after-close" }))

      expect(runtime.sent).toEqual([])
      expectFailure(exit, WorkerStaleHandleError)
    })
  ))

test("Worker send rejects handles after runtime exit", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* makeFakeRuntime()
      const fixture = yield* makeFixture(makeFakeAdapter(runtime), [filesystemReadCapability])
      const handle = yield* fixture.service.spawn({
        script: "./worker.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })
      yield* runtime.complete()
      yield* waitUntil(
        Effect.gen(function* () {
          const snapshot = yield* fixture.registry.list()
          return snapshot.entries.length === 0
        })
      )

      const exit = yield* Effect.exit(handle.send({ text: "after-close" }))

      expect(runtime.sent).toEqual([])
      expectFailure(exit, WorkerStaleHandleError)
    })
  ))

test("Worker validates malformed outputs on the messages stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* makeFakeRuntime()
      const fixture = yield* makeFixture(makeFakeAdapter(runtime), [filesystemReadCapability])
      const handle = yield* fixture.service.spawn({
        script: "./worker.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })

      yield* runtime.emit({ nope: true })
      const exit = yield* Effect.exit(handle.messages.pipe(Stream.take(1), Stream.runCollect))

      expectFailure(exit, WorkerChannelError)
    })
  ))

test("Worker disposes two workers in deterministic newest-first scope order", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const disposals: string[] = []
      const first = yield* makeFakeRuntime("first", disposals)
      const second = yield* makeFakeRuntime("second", disposals)
      const runtimes = [first, second]
      const fixture = yield* makeFixture(
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

      yield* fixture.service.spawn({
        script: "./first.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })
      yield* fixture.service.spawn({
        script: "./second.ts",
        inputSchema: EchoIn,
        outputSchema: EchoOut,
        context,
        capabilities: [filesystemReadCapability]
      })
      yield* fixture.registry.closeScope("scope-main")

      expect(disposals).toEqual(["second", "first"])
    })
  ))

test("Worker default Bun adapter sends, receives, and closes a real worker", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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
      const fixture = yield* makeFixture(undefined, [], { gracefulShutdownMs: 0 })

      try {
        const handle = yield* fixture.service.spawn({
          script,
          inputSchema: EchoIn,
          outputSchema: EchoOut,
          context
        })

        yield* handle.send({ text: "hello" })
        const messages = yield* handle.messages.pipe(Stream.take(1), Stream.runCollect)
        yield* handle.close

        expect(Array.from(messages)).toEqual([{ echoed: "hello" }])
      } finally {
        URL.revokeObjectURL(script)
      }
    })
  ))

test("Worker default Bun adapter reports construction failures as Unsupported", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const originalWorker = globalThis.Worker

      class ThrowingConstructorWorker {
        constructor(_script: string) {
          throw new Error("Worker construction failed")
        }
      }

      replaceGlobalWorker(ThrowingConstructorWorker)

      const fixture = yield* makeFixture()

      try {
        const exit = yield* Effect.exit(
          fixture.service.spawn({
            script: "missing-worker.ts",
            inputSchema: EchoIn,
            outputSchema: EchoOut,
            context
          })
        )

        expectFailure(exit, WorkerUnsupportedError)
      } finally {
        replaceGlobalWorker(originalWorker)
      }
    })
  ))

test("Bun adapter shutdown stays infallible when shutdown stages throw", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const originalWorker = globalThis.Worker
      const throwingWorkerLog: string[] = []

      class ThrowingWorker {
        constructor(_script: string) {}
        addEventListener(..._args: readonly unknown[]): void {}
        removeEventListener(..._args: readonly unknown[]): void {}
        postMessage(_message: unknown, ..._transfer: readonly unknown[]): void {
          throwingWorkerLog.push("postMessage")
          throw new Error("postMessage failed")
        }
        terminate(): void {
          throwingWorkerLog.push("terminate")
          throw new Error("terminate failed")
        }
      }

      replaceGlobalWorker(ThrowingWorker)

      const file = new File(
        [`self.onmessage = (event) => { if (event.data?._tag === "Shutdown") { close() } }`],
        "effect-desktop-worker-test.ts",
        { type: "application/typescript" }
      )
      const script = URL.createObjectURL(file)
      const fixture = yield* makeFixture(undefined, [], { gracefulShutdownMs: 0 })

      try {
        const handle = yield* fixture.service.spawn({
          script,
          inputSchema: EchoIn,
          outputSchema: EchoOut,
          context
        })

        yield* handle.close
        const afterClose = yield* fixture.registry.list()

        expect(afterClose.entries).toEqual([])
        expect(throwingWorkerLog).toEqual(["postMessage", "terminate"])
      } finally {
        URL.revokeObjectURL(script)
        replaceGlobalWorker(originalWorker)
      }
    })
  ))

test("Bun adapter removes worker event listeners when closed", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const originalWorker = globalThis.Worker
      const listeners = new Map<string, Set<unknown>>()
      const listenerCount = () =>
        Array.from(listeners.values()).reduce((total, current) => total + current.size, 0)

      class ListenerTrackingWorker {
        constructor(_script: string) {}
        addEventListener(type: string, listener: unknown): void {
          const current = listeners.get(type) ?? new Set<unknown>()
          current.add(listener)
          listeners.set(type, current)
        }
        removeEventListener(type: string, listener: unknown): void {
          listeners.get(type)?.delete(listener)
        }
        postMessage(_message: unknown, ..._transfer: readonly unknown[]): void {}
        terminate(): void {}
      }

      replaceGlobalWorker(ListenerTrackingWorker)

      const file = new File([`self.onmessage = () => {}`], "effect-desktop-worker-listeners.ts", {
        type: "application/typescript"
      })
      const script = URL.createObjectURL(file)
      const fixture = yield* makeFixture(undefined, [], { gracefulShutdownMs: 0 })

      try {
        const handle = yield* fixture.service.spawn({
          script,
          inputSchema: EchoIn,
          outputSchema: EchoOut,
          context
        })

        expect(listenerCount()).toBe(4)
        yield* handle.close

        expect(listenerCount()).toBe(0)
      } finally {
        URL.revokeObjectURL(script)
        replaceGlobalWorker(originalWorker)
      }
    })
  ))

const makeFixture = (
  adapter?: WorkerAdapter,
  allowedCapabilities: readonly NormalizedCapability[] = [],
  options: {
    readonly gracefulShutdownMs?: number
    readonly inspector?: ExecutionInspectorCollectorApi
    readonly maxConcurrent?: number
    readonly now?: () => number
    readonly nowStart?: number
    readonly workerNowStart?: number
  } = {}
) =>
  Effect.gen(function* () {
    let resourceNow = 1
    let workerNow = options.workerNowStart ?? options.nowStart ?? 1
    const registry = yield* makeResourceRegistry({
      now: () => resourceNow++,
      nextId: (timestamp) => id(`resource-${timestamp}`)
    })
    const permissions = yield* makePermissionRegistry({ traceId: () => "trace" })
    for (const capability of allowedCapabilities) {
      yield* permissions.declare(capability, {
        actor: TEST_OWNER.actor,
        source: "worker-test",
        effect: "allow"
      })
    }
    const service = yield* makeWorker(registry, permissions, TEST_OWNER, {
      now: options.now ?? (() => workerNow++),
      ...(adapter === undefined ? {} : { adapter }),
      ...(options.inspector === undefined ? {} : { inspector: options.inspector }),
      ...(options.maxConcurrent === undefined
        ? {}
        : { budgets: { maxConcurrent: options.maxConcurrent } }),
      ...(options.gracefulShutdownMs === undefined
        ? {}
        : { gracefulShutdownMs: options.gracefulShutdownMs })
    })

    return { service, registry }
  })

interface FakeWorkerRuntime extends WorkerRuntime {
  readonly sent: unknown[]
  readonly shutdowns: number
  readonly complete: () => Effect.Effect<void, WorkerError, never>
  readonly emit: (message: unknown) => Effect.Effect<void, WorkerError, never>
  readonly crash: (exitCode: number) => Effect.Effect<void, WorkerError, never>
}

const makeFakeRuntime = (
  disposalName?: string,
  disposals: string[] = [],
  shutdownCompletesExit = true
): Effect.Effect<FakeWorkerRuntime> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<unknown, WorkerError | Cause.Done>()
    const exit = yield* Deferred.make<void, WorkerError>()
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
        shutdownCompletesExit ? Effect.andThen(Deferred.succeed(exit, undefined)) : Effect.asVoid,
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
  })

const waitUntil = (
  predicate: Effect.Effect<boolean, WaitUntilError>
): Effect.Effect<void, WaitUntilError> =>
  predicate.pipe(
    Effect.flatMap((ready) =>
      ready
        ? Effect.void
        : Effect.fail(
            new WaitUntilError({ message: "condition was not met", cause: Option.none() })
          )
    ),
    Effect.retry(Schedule.spaced("10 millis").pipe(Schedule.both(Schedule.recurs(50)))),
    Effect.mapError(
      () => new WaitUntilError({ message: "condition was not met", cause: Option.none() })
    )
  )

const replaceGlobalWorker = (worker: unknown): void => {
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: worker,
    writable: true
  })
}

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.void
})

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
