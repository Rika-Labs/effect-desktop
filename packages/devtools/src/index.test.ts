import { expect, test } from "bun:test"
import {
  CommandRegistry,
  Job,
  makeBridgeCallRegistry,
  makeBridgeStreamRegistry,
  makeJob,
  makeCommandRegistry,
  makePermissionRegistry,
  makeProcess,
  makeResourceRegistry,
  makeTelemetry,
  makeWorker,
  PermissionRegistry,
  PermissionActor,
  PermissionContext,
  Process,
  ProcessExitStatus,
  ResourceRegistry,
  Telemetry,
  Worker,
  type JobApi,
  type NormalizedCapability,
  type ProcessAdapter,
  type ProcessApi,
  type ProcessChild,
  type ResourceRegistryApi,
  type WorkerApi,
  type WorkerAdapter,
  type WorkerError,
  type WorkerRuntime
} from "@effect-desktop/core"
import { Cause, Deferred, Effect, Fiber, Layer, Option, Queue, Schema, Stream } from "effect"

import {
  CommandsDevtools,
  CommandsDevtoolsLive,
  DiagnosticsPanels,
  DiagnosticsPanelsLive,
  LiveRuntimePanels,
  LiveRuntimePanelsLive,
  PerformanceOverlay,
  PerformanceOverlayLive,
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

test("LiveRuntimePanels projects bridge, stream, resource, permission, and process tables", async () => {
  let timestamp = 1_000
  const bridgeCalls = await Effect.runPromise(makeBridgeCallRegistry())
  const streams = makeBridgeStreamRegistry()
  const resources = await Effect.runPromise(
    makeResourceRegistry({
      now: () => timestamp++,
      nextId: (now) => `resource-${now}` as never
    })
  )
  const permissions = await Effect.runPromise(
    makePermissionRegistry({ traceId: () => "trace-panel", nextToken: () => "grant-panel" })
  )
  const processes = await makeProcessService(resources)

  await Effect.runPromise(
    bridgeCalls.record({
      tag: "Pending",
      id: "request-complete",
      traceId: "trace-panel",
      startedAt: 100
    })
  )
  await Effect.runPromise(
    bridgeCalls.record({
      tag: "Running",
      id: "request-complete",
      handler: "Project.open"
    })
  )
  await Effect.runPromise(
    bridgeCalls.record({
      tag: "Completed",
      id: "request-complete",
      completedAt: 145
    })
  )
  await Effect.runPromise(
    bridgeCalls.record({
      tag: "Failed",
      id: "request-secret",
      error: { _tag: "BridgeFailure", token: "secret-token" }
    })
  )
  await Effect.runPromise(streams.register("stream-panel"))
  await Effect.runPromise(
    streams.updateBackpressure("stream-panel", {
      evictedFrames: 1,
      overflow: "dropNewest",
      queueCapacity: 8,
      queueDepth: 3
    })
  )
  await Effect.runPromise(
    resources.register({
      id: "resource-panel" as never,
      kind: "window",
      ownerScope: "scope-main",
      state: "open"
    })
  )
  await Effect.runPromiseExit(
    permissions.check(commandCapability, {
      actor: new PermissionActor({ kind: "window", id: "window-main" }),
      traceId: "trace-panel"
    })
  )
  const handle = await Effect.runPromise(
    processes.spawn("echo", ["hi"], { ownerScope: "scope-main" })
  )
  await Effect.runPromise(handle.exit)

  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const panels = yield* LiveRuntimePanels
      return yield* panels.list()
    }).pipe(
      Effect.provide(
        Layer.provide(
          LiveRuntimePanelsLive({ bridgeCalls, streams }, { now: () => 1_100 }),
          Layer.mergeAll(
            Layer.succeed(ResourceRegistry)(resources),
            Layer.succeed(PermissionRegistry)(permissions),
            Layer.succeed(Process)(processes)
          )
        )
      )
    )
  )

  expect(snapshot.bridgeCalls.find((row) => row.id === "request-complete")).toMatchObject({
    contractTag: Option.some("Project"),
    latencyMs: Option.some(45)
  })
  expect(snapshot.bridgeCalls.find((row) => row.id === "request-secret")?.errorTag).toEqual(
    Option.some("BridgeFailure")
  )
  expect(JSON.stringify(snapshot.bridgeCalls)).not.toContain("secret-token")
  expect(snapshot.streams[0]).toMatchObject({ id: "stream-panel", state: "open" })
  expect(snapshot.resources[0]).toMatchObject({
    id: "resource-panel",
    kind: "window",
    scope: "scope-main"
  })
  expect(snapshot.permissions[0]?.decision).toBe("denied")
  expect(snapshot.permissions[0]?.remediation).toEqual(
    Option.some("Declare or approve native.invoke for window:window-main.")
  )
  expect(snapshot.processes[0]).toMatchObject({
    pid: 55,
    command: "echo",
    childPids: [56],
    state: "exited"
  })
})

test("DiagnosticsPanels projects redacted logs, grouped traces, and metrics", async () => {
  const telemetry = await Effect.runPromise(
    makeTelemetry({ now: () => 1_000, nextSpanId: () => "span-generated" })
  )
  await Effect.runPromise(
    telemetry.log({
      level: "error",
      subsystem: "bridge",
      operation: "Bridge.call",
      traceId: "trace-diagnostics",
      windowId: "window-main",
      message: "bridge failed",
      fields: { token: "secret-token", safe: "value" }
    })
  )
  await Effect.runPromise(
    telemetry.recordSpan({
      traceId: "trace-diagnostics",
      spanId: "root",
      subsystem: "renderer",
      operation: "Renderer.click",
      name: "renderer click",
      startedAt: 1,
      endedAt: 3
    })
  )
  await Effect.runPromise(
    telemetry.recordSpan({
      traceId: "trace-diagnostics",
      parentSpanId: "root",
      subsystem: "runtime",
      operation: "Command.invoke",
      name: "runtime command",
      startedAt: 4,
      endedAt: 10,
      attributes: { apiKey: "secret-key" }
    })
  )
  await Effect.runPromise(
    telemetry.incrementCounter({
      name: "bridge.calls",
      tags: { subsystem: "bridge" }
    })
  )
  await Effect.runPromise(telemetry.recordHistogram({ name: "bridge.latency", value: 32 }))

  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const panels = yield* DiagnosticsPanels
      return yield* panels.list()
    }).pipe(
      Effect.provide(Layer.provide(DiagnosticsPanelsLive(), Layer.succeed(Telemetry)(telemetry)))
    )
  )

  expect(snapshot.logs[0]).toMatchObject({
    level: "error",
    subsystem: "bridge",
    operation: "Bridge.call",
    traceId: "trace-diagnostics",
    message: "bridge failed"
  })
  expect(snapshot.traces[0]?.traceId).toBe("trace-diagnostics")
  expect(snapshot.traces[0]?.spans.map((span) => span.name)).toEqual([
    "renderer click",
    "runtime command"
  ])
  expect(snapshot.metrics.map((metric) => metric.name).sort()).toEqual([
    "bridge.calls",
    "bridge.latency"
  ])
  expect(JSON.stringify(snapshot)).not.toContain("secret-token")
  expect(JSON.stringify(snapshot)).not.toContain("secret-key")

  const disabledTelemetry = await Effect.runPromise(makeTelemetry({ tracingEnabled: false }))
  await Effect.runPromise(
    disabledTelemetry.recordSpan({
      traceId: "trace-disabled",
      subsystem: "runtime",
      operation: "Runtime.disabled",
      name: "disabled",
      startedAt: 1
    })
  )
  const disabledSnapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const panels = yield* DiagnosticsPanels
      return yield* panels.list()
    }).pipe(
      Effect.provide(
        Layer.provide(DiagnosticsPanelsLive(), Layer.succeed(Telemetry)(disabledTelemetry))
      )
    )
  )
  expect(disabledSnapshot.traces).toEqual([])
})

test("PerformanceOverlay compares startup, bridge p99, and render frame metrics to budgets", async () => {
  const telemetry = await Effect.runPromise(makeTelemetry({ now: () => 1_000 }))
  await Effect.runPromise(telemetry.recordHistogram({ name: "startup.cli.config_load", value: 80 }))
  await Effect.runPromise(telemetry.recordHistogram({ name: "startup.runtime_boot", value: 300 }))
  await Effect.runPromise(
    telemetry.recordHistogram({
      name: "bridge.latency",
      value: 42,
      tags: { contractTag: "Project", token: "secret-token" }
    })
  )
  await Effect.runPromise(
    telemetry.recordHistogram({
      name: "bridge.latency",
      value: 55,
      tags: { contractTag: "Project", windowId: "window-main" }
    })
  )
  await Effect.runPromise(telemetry.recordHistogram({ name: "bridge.latency", value: 60 }))
  await Effect.runPromise(telemetry.recordHistogram({ name: "renderer.frame", value: 12 }))

  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const overlay = yield* PerformanceOverlay
      return yield* overlay.list()
    }).pipe(
      Effect.provide(Layer.provide(PerformanceOverlayLive(), Layer.succeed(Telemetry)(telemetry)))
    )
  )

  expect(snapshot.startup.find((row) => row.id === "cli.config-load")).toMatchObject({
    valueMs: Option.some(80),
    budgetMs: 100,
    status: "within-budget"
  })
  expect(snapshot.startup.find((row) => row.id === "runtime.boot")).toMatchObject({
    valueMs: Option.some(300),
    budgetMs: 250,
    status: "over-budget"
  })
  expect(snapshot.startup.find((row) => row.id === "native.host-boot")).toMatchObject({
    valueMs: Option.none(),
    status: "missing"
  })
  expect(snapshot.bridgeP99.find((row) => row.contractTag === "Project")).toMatchObject({
    valueMs: Option.some(55),
    budgetMs: 50,
    status: "over-budget"
  })
  expect(snapshot.bridgeP99.filter((row) => row.contractTag === "Project")).toHaveLength(1)
  expect(snapshot.bridgeP99.find((row) => row.contractTag === "unknown")).toMatchObject({
    valueMs: Option.some(60),
    status: "over-budget"
  })
  expect(snapshot.renderFrame).toMatchObject({
    valueMs: Option.some(12),
    status: "within-budget"
  })
  expect(JSON.stringify(snapshot)).not.toContain("secret-token")
})

interface WorkersJobsFixture {
  readonly registry: ResourceRegistryApi
  readonly worker: WorkerApi
  readonly job: JobApi
}

const makeProcessService = (registry: ResourceRegistryApi): Promise<ProcessApi> =>
  Effect.runPromise(
    makeProcess(registry, {
      adapter: fakeProcessAdapter,
      permissions: { spawn: ["echo"] }
    })
  )

const fakeProcessAdapter: ProcessAdapter = {
  spawn: () => fakeProcessChild()
}

const fakeProcessChild = (): ProcessChild => ({
  pid: 55,
  childPids: [56],
  stdout: new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    }
  }),
  stderr: new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    }
  }),
  exited: Promise.resolve(new ProcessExitStatus({ code: 0 })),
  writeStdin: () => Promise.resolve(),
  closeStdin: () => Promise.resolve(),
  isRunning: () => false,
  terminateTree: () => Promise.resolve(),
  forceKillTree: () => Promise.resolve(),
  kill: () => undefined
})

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
