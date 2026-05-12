import { expect, test } from "bun:test"
import {
  CommandRegistry,
  makeBridgeCallRegistry,
  makeBridgeStreamRegistry,
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
  WorkersDevtools,
  WorkersDevtoolsLive,
  type WorkersSnapshot
} from "./index.js"
import { DevtoolsInvalidOptionError } from "./panel-options.js"

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

test("WorkersDevtools lists live workers with redacted scripts", async () => {
  const fixture = await makeWorkersFixture()
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

  const snapshot = await waitForWorkersSnapshot(fixture, (snapshot) =>
    snapshot.workers.some((row) => row.resourceId === workerHandle.resource.id)
  )

  expect(snapshot.workers.map((worker) => worker.script)).toEqual(["./secret-worker.ts"])

  await Effect.runPromise(workerHandle.close)
})

test("LiveRuntimePanels projects bridge, stream, resource, permission, and process tables", async () => {
  let timestamp = 1_000
  const bridgeCalls = await Effect.runPromise(makeBridgeCallRegistry())
  const streams = await Effect.runPromise(makeBridgeStreamRegistry())
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

test("LiveRuntimePanels rejects invalid row caps and refresh intervals", async () => {
  const bridgeCalls = await Effect.runPromise(makeBridgeCallRegistry())
  const streams = await Effect.runPromise(makeBridgeStreamRegistry())
  const resources = await Effect.runPromise(makeResourceRegistry())
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const processes = await makeProcessService(resources)
  const run = (options: {
    readonly maxRows?: number
    readonly frameInterval?: `${number} millis`
  }) =>
    Effect.runSync(
      Effect.gen(function* () {
        return yield* LiveRuntimePanels
      }).pipe(
        Effect.provide(
          Layer.provide(
            LiveRuntimePanelsLive({ bridgeCalls, streams }, options),
            Layer.mergeAll(
              Layer.succeed(ResourceRegistry)(resources),
              Layer.succeed(PermissionRegistry)(permissions),
              Layer.succeed(Process)(processes)
            )
          )
        )
      )
    )

  expect(() => run({ maxRows: 0 })).toThrow(DevtoolsInvalidOptionError)
  expect(() => run({ maxRows: -1 })).toThrow(DevtoolsInvalidOptionError)
  expect(() => run({ maxRows: 1.5 })).toThrow(DevtoolsInvalidOptionError)
  expect(() => run({ frameInterval: "0 millis" })).toThrow(DevtoolsInvalidOptionError)
  expect(() => run({ frameInterval: "-1 millis" })).toThrow(DevtoolsInvalidOptionError)
  expect(() => run({ maxRows: 1, frameInterval: "16 millis" })).not.toThrow()
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

test("DiagnosticsPanels rejects invalid row caps and refresh intervals", async () => {
  const telemetry = await Effect.runPromise(makeTelemetry())
  const run = (options: {
    readonly maxRows?: number
    readonly frameInterval?: `${number} millis`
  }) =>
    Effect.runSync(
      Effect.gen(function* () {
        return yield* DiagnosticsPanels
      }).pipe(
        Effect.provide(
          Layer.provide(DiagnosticsPanelsLive(options), Layer.succeed(Telemetry)(telemetry))
        )
      )
    )

  expect(() => run({ maxRows: 0 })).toThrow(DevtoolsInvalidOptionError)
  expect(() => run({ maxRows: -1 })).toThrow(DevtoolsInvalidOptionError)
  expect(() => run({ maxRows: 1.5 })).toThrow(DevtoolsInvalidOptionError)
  expect(() => run({ frameInterval: "0 millis" })).toThrow(DevtoolsInvalidOptionError)
  expect(() => run({ frameInterval: "-1 millis" })).toThrow(DevtoolsInvalidOptionError)
  expect(() => run({ maxRows: 1, frameInterval: "16 millis" })).not.toThrow()
})

test("DiagnosticsPanels keeps trace groups internally consistent under row caps", async () => {
  const telemetry = await Effect.runPromise(makeTelemetry())
  await Effect.runPromise(
    telemetry.recordSpan({
      traceId: "trace-1",
      spanId: "root",
      subsystem: "runtime",
      operation: "root",
      name: "root",
      startedAt: 1,
      endedAt: 2
    })
  )
  await Effect.runPromise(
    telemetry.recordSpan({
      traceId: "trace-1",
      spanId: "child",
      parentSpanId: "root",
      subsystem: "runtime",
      operation: "child",
      name: "child",
      startedAt: 3,
      endedAt: 4
    })
  )

  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const panels = yield* DiagnosticsPanels
      return yield* panels.list()
    }).pipe(
      Effect.provide(
        Layer.provide(DiagnosticsPanelsLive({ maxRows: 1 }), Layer.succeed(Telemetry)(telemetry))
      )
    )
  )

  expect(snapshot.traces).toHaveLength(1)
  expect(snapshot.traces[0]?.spans.map((span) => span.spanId)).toEqual(["root", "child"])
})

test("DiagnosticsPanels preserves recent trace activity when row caps include parent spans", async () => {
  const telemetry = await Effect.runPromise(makeTelemetry())
  await Effect.runPromise(
    telemetry.recordSpan({
      traceId: "trace-a",
      spanId: "root-a",
      subsystem: "runtime",
      operation: "root-a",
      name: "root a",
      startedAt: 1,
      endedAt: 2
    })
  )
  await Effect.runPromise(
    telemetry.recordSpan({
      traceId: "trace-b",
      spanId: "root-b",
      subsystem: "runtime",
      operation: "root-b",
      name: "root b",
      startedAt: 3,
      endedAt: 4
    })
  )
  await Effect.runPromise(
    telemetry.recordSpan({
      traceId: "trace-a",
      spanId: "child-a",
      parentSpanId: "root-a",
      subsystem: "runtime",
      operation: "child-a",
      name: "child a",
      startedAt: 5,
      endedAt: 6
    })
  )

  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const panels = yield* DiagnosticsPanels
      return yield* panels.list()
    }).pipe(
      Effect.provide(
        Layer.provide(DiagnosticsPanelsLive({ maxRows: 1 }), Layer.succeed(Telemetry)(telemetry))
      )
    )
  )

  expect(snapshot.traces.map((trace) => trace.traceId)).toEqual(["trace-a"])
  expect(snapshot.traces[0]?.spans.map((span) => span.spanId)).toEqual(["root-a", "child-a"])
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

interface WorkersFixture {
  readonly registry: ResourceRegistryApi
  readonly worker: WorkerApi
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

const makeWorkersFixture = async (): Promise<WorkersFixture> => {
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
  return { registry, worker }
}

const waitForWorkersSnapshot = async (
  fixture: WorkersFixture,
  predicate: (snapshot: WorkersSnapshot) => boolean
): Promise<WorkersSnapshot> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        const devtools = yield* WorkersDevtools
        return yield* devtools.list()
      }).pipe(
        Effect.provide(Layer.provide(WorkersDevtoolsLive, Layer.succeed(Worker)(fixture.worker)))
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
