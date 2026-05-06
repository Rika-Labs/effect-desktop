import { expect, test } from "bun:test"
import {
  CommandRegistry,
  Job,
  makeJob,
  makeCommandRegistry,
  makePermissionRegistry,
  makeResourceRegistry,
  makeWorker,
  PermissionActor,
  PermissionContext,
  Worker,
  type JobApi,
  type NormalizedCapability,
  type ResourceRegistryApi,
  type WorkerApi,
  type WorkerAdapter,
  type WorkerError,
  type WorkerRuntime
} from "@effect-desktop/core"
import { Cause, Deferred, Effect, Fiber, Layer, Queue, Schema, Stream } from "effect"

import {
  CommandsDevtools,
  CommandsDevtoolsLive,
  WorkersJobsDevtools,
  WorkersJobsDevtoolsLive,
  type WorkersJobsSnapshot
} from "./index.js"

const commandCapability: NormalizedCapability = {
  kind: "native.invoke",
  primitive: "Command",
  methods: ["app.file.open"],
  audit: "always"
}

test("CommandsDevtools lists registered commands and observes invocation telemetry", async () => {
  let timestamp = 100
  const resources = await Effect.runPromise(makeResourceRegistry())
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const commands = await Effect.runPromise(
    makeCommandRegistry(resources, permissions, {
      now: () => timestamp++
    })
  )
  await Effect.runPromise(permissions.declare(commandCapability, { source: "test" }))
  await Effect.runPromise(
    commands.register({
      id: "app.file.open",
      inputSchema: Schema.Struct({ path: Schema.String }),
      outputSchema: Schema.Void,
      capability: commandCapability,
      ownerScope: "app",
      handler: () => Effect.void
    })
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const devtools = yield* CommandsDevtools
      const firstList = yield* devtools.list()
      const observed = yield* devtools
        .observeInvocations()
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
      yield* commands.invoke(
        "app.file.open",
        { path: "/tmp/project" },
        new PermissionContext({
          actor: new PermissionActor({ kind: "window", id: "window-1" }),
          traceId: "trace-1"
        })
      )
      const events = yield* Fiber.join(observed)
      const finalList = yield* devtools.list()
      return { events: Array.from(events), finalList, firstList }
    }).pipe(
      Effect.provide(Layer.provide(CommandsDevtoolsLive, Layer.succeed(CommandRegistry)(commands)))
    )
  )

  expect(result.firstList.map((command) => command.id)).toEqual(["app.file.open"])
  expect(result.firstList[0]?.invocationCount).toBe(0)
  expect(result.events[0]?.commandId).toBe("app.file.open")
  expect(result.events[0]?.outcome).toBe("success")
  expect(result.events[0]?.traceId).toBe("trace-1")
  expect(result.finalList[0]?.invocationCount).toBe(1)
  expect(result.finalList[0]?.lastInvocation?.outcome).toBe("success")
})

test("WorkersJobsDevtools lists live workers and jobs with redacted progress", async () => {
  const fixture = await makeWorkersJobsFixture()
  const workerHandle = await Effect.runPromise(
    fixture.worker.spawn({
      script: "./secret-worker.ts",
      ownerScope: "scope-main",
      inputSchema: Schema.Struct({ text: Schema.String }),
      outputSchema: Schema.Struct({ echoed: Schema.String }),
      context: new PermissionContext({
        actor: new PermissionActor({ kind: "app", id: "app-main" }),
        traceId: "trace-devtools"
      })
    })
  )
  const jobHandle = await Effect.runPromise(
    fixture.job.run({
      id: "job-devtools",
      ownerScope: "scope-main",
      effect: Effect.never,
      progress: Stream.fromIterable([{ step: 1, token: "runtime-secret" }]),
      progressSchema: Schema.Struct({
        step: Schema.Number,
        token: Schema.String
      })
    })
  )

  const snapshot = await waitForDevtoolsSnapshot(fixture, (snapshot) => {
    const job = snapshot.jobs.find((row) => row.id === "job-devtools")
    return (
      snapshot.workers.some((row) => row.resourceId === workerHandle.resource.id) &&
      job?.lastProgress !== undefined
    )
  })
  const job = snapshot.jobs.find((row) => row.id === "job-devtools")

  expect(snapshot.workers.map((worker) => worker.script)).toEqual(["./secret-worker.ts"])
  expect(job?.lastProgress?.value).toEqual({ step: 1, token: "[REDACTED]" })

  await Effect.runPromise(workerHandle.close)
  await Effect.runPromise(jobHandle.cancel)
})

interface WorkersJobsFixture {
  readonly registry: ResourceRegistryApi
  readonly worker: WorkerApi
  readonly job: JobApi
}

const makeWorkersJobsFixture = async (): Promise<WorkersJobsFixture> => {
  let timestamp = 1_000
  const registry = await Effect.runPromise(
    makeResourceRegistry({
      now: () => timestamp++,
      nextId: (now) => `resource-${now}` as never
    })
  )
  const permissions = await Effect.runPromise(makePermissionRegistry({ traceId: () => "trace" }))
  const runtime = await makeFakeRuntime()
  const worker = await Effect.runPromise(
    makeWorker(registry, permissions, {
      adapter: makeFakeAdapter(runtime),
      now: () => timestamp++
    })
  )
  const job = await Effect.runPromise(
    makeJob(registry, {
      now: () => timestamp++,
      nextId: () => `job-${timestamp++}`
    })
  )
  return { registry, worker, job }
}

const waitForDevtoolsSnapshot = async (
  fixture: WorkersJobsFixture,
  predicate: (snapshot: WorkersJobsSnapshot) => boolean
): Promise<WorkersJobsSnapshot> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        const devtools = yield* WorkersJobsDevtools
        return yield* devtools.list()
      }).pipe(
        Effect.provide(
          Layer.provide(
            WorkersJobsDevtoolsLive,
            Layer.merge(Layer.succeed(Worker)(fixture.worker), Layer.succeed(Job)(fixture.job))
          )
        )
      )
    )
    if (predicate(snapshot)) {
      return snapshot
    }
    await Bun.sleep(10)
  }

  throw new Error("devtools snapshot did not match")
}

const makeFakeAdapter = (runtime: WorkerRuntime): WorkerAdapter => ({
  spawn: () => Effect.succeed(runtime)
})

const makeFakeRuntime = async (): Promise<WorkerRuntime> => {
  const queue = await Effect.runPromise(Queue.unbounded<unknown, WorkerError | Cause.Done>())
  const exit = await Effect.runPromise(Deferred.make<void, WorkerError>())
  return {
    send: () => Effect.void,
    messages: Stream.fromQueue(queue),
    exit: Deferred.await(exit),
    shutdown: Queue.shutdown(queue).pipe(
      Effect.andThen(Deferred.succeed(exit, undefined)),
      Effect.asVoid
    )
  }
}
