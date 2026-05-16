import { expect, test } from "bun:test"
import {
  CommandRegistry,
  makeBridgeCallRegistry,
  makeBridgeStreamRegistry,
  makeCommandRegistry,
  makePermissionRegistry,
  makeProcess,
  makeResourceId,
  makeResourceRegistry,
  makeTelemetry,
  makeWorker,
  Desktop,
  InspectorSafetyPolicyLive,
  PermissionRegistry,
  PermissionActor,
  PermissionContext,
  Process,
  ResourceRegistry,
  RpcCapability,
  Telemetry,
  Worker,
  type NormalizedCapability,
  type ProcessApi,
  type ResourceOwnerApi,
  type ResourceRegistryApi,
  type WorkerApi,
  type WorkerAdapter,
  type WorkerError,
  type WorkerRuntime
} from "@effect-desktop/core"
import {
  Cause,
  Clock,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Queue,
  Schedule,
  Schema,
  Sink,
  Stream
} from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

import {
  CommandsDevtools,
  CommandsDevtoolsLive,
  DiagnosticsPanels,
  DiagnosticsPanelsLive,
  FiberInspectorCollector,
  FiberInspectorCollectorLive,
  LayerGraphPanel,
  LayerGraphPanelLive,
  LiveRuntimePanels,
  LiveRuntimePanelsLive,
  PerformanceOverlay,
  PerformanceOverlayLive,
  ResourceInspectorCollector,
  ResourceInspectorCollectorLive,
  ScopeInspectorCollector,
  ScopeInspectorCollectorLive,
  StreamInspectorCollector,
  StreamInspectorCollectorLive,
  WorkersDevtools,
  WorkersDevtoolsLive,
  type WorkersSnapshot
} from "./index.js"
import { DevtoolsInvalidOptionError } from "./panel-options.js"

const TEST_OWNER: ResourceOwnerApi = Object.freeze({
  kind: "test",
  scopeId: "scope-main",
  actor: new PermissionActor({ kind: "resource", id: "scope-main" }),
  attributes: Object.freeze({ scopeId: "scope-main" })
})

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
  const commandId = "app.file.open" as const
  const Command = Rpc.make(commandId, {
    payload: Schema.Struct({ path: Schema.String }),
    success: Schema.Void,
    error: Schema.Unknown
  }).pipe(RpcCapability(commandCapability))
  const Commands = RpcGroup.make(Command)
  await Effect.runPromise(
    commands.registerGroup({
      group: Commands,
      ownerScope: "app",
      handlers: Commands.toLayerHandler(commandId, () => Effect.void)
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
      inputSchema: Schema.Struct({ text: Schema.String }),
      outputSchema: Schema.Struct({ echoed: Schema.String }),
      context: { traceId: "trace-devtools" }
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
      nextId: (now) => makeResourceId(`resource-${now}`)
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
      id: makeResourceId("resource-panel"),
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
  const handle = await Effect.runPromise(processes.spawn("echo", ["hi"]))
  await Effect.runPromise(handle.exit)

  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const panels = yield* LiveRuntimePanels
      return yield* panels.list()
    }).pipe(
      Effect.provide(
        Layer.provide(
          LiveRuntimePanelsLive({ bridgeCalls, streams }),
          Layer.mergeAll(
            Layer.succeed(ResourceRegistry)(resources),
            Layer.succeed(PermissionRegistry)(permissions),
            Layer.succeed(Process)(processes),
            InspectorSafetyPolicyLive()
          )
        )
      ),
      Effect.provideService(Clock.Clock, fixedClock(1_100))
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
    scope: "scope-main",
    ageMs: 100
  })
  expect(snapshot.permissions[0]?.decision).toBe("denied")
  expect(snapshot.permissions[0]?.remediation).toEqual(
    Option.some("Declare or approve native.invoke for window:window-main.")
  )
  expect(snapshot.processes[0]).toMatchObject({
    pid: 55,
    command: "echo",
    state: "exited"
  })
})

test("Inspector collectors stream resource, scope, fiber, and stream lifecycle events", async () => {
  const resources = await Effect.runPromise(
    makeResourceRegistry({
      nextId: () => makeResourceId("resource-collector")
    })
  )
  const streams = await Effect.runPromise(makeBridgeStreamRegistry())

  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const resourceCollector = yield* ResourceInspectorCollector
        const scopeCollector = yield* ScopeInspectorCollector
        const fiberCollector = yield* FiberInspectorCollector
        const streamCollector = yield* StreamInspectorCollector

        const resourceEvents = yield* resourceCollector
          .events()
          .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
        const scopeEvents = yield* scopeCollector
          .events()
          .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
        const fiberEvents = yield* fiberCollector
          .events()
          .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
        const streamEvents = yield* streamCollector
          .events()
          .pipe(Stream.take(3), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

        yield* resources.declareScope("scope-main")
        yield* resources.register({
          kind: "window",
          ownerScope: "scope-main",
          state: "open"
        })
        yield* resources.closeScope("scope-main")

        yield* fiberCollector.run("collector-fiber", Effect.void)

        yield* streams.register("stream-collector")
        yield* streams.updateBackpressure("stream-collector", {
          evictedFrames: 0,
          overflow: "dropOldest",
          queueCapacity: 8,
          queueDepth: 2
        })
        yield* streams.terminate("stream-collector", "complete", 1_000)

        return {
          resourceEvents: yield* Fiber.join(resourceEvents),
          scopeEvents: yield* Fiber.join(scopeEvents),
          fiberEvents: yield* Fiber.join(fiberEvents),
          streamEvents: yield* Fiber.join(streamEvents)
        }
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.provide(
              Layer.mergeAll(ResourceInspectorCollectorLive, ScopeInspectorCollectorLive),
              Layer.succeed(ResourceRegistry)(resources)
            ),
            FiberInspectorCollectorLive,
            StreamInspectorCollectorLive(streams)
          )
        )
      )
    )
  )

  expect(Array.from(result.resourceEvents).map((event) => event._tag)).toEqual([
    "ResourceRegistered",
    "ResourceDisposed"
  ])
  expect(Array.from(result.scopeEvents).map((event) => event._tag)).toEqual([
    "ScopeDeclared",
    "ScopeClosing"
  ])
  expect(Array.from(result.fiberEvents).map((event) => event._tag)).toEqual([
    "FiberStarted",
    "FiberCompleted"
  ])
  expect(Array.from(result.streamEvents).map((event) => event._tag)).toEqual([
    "StreamOpened",
    "StreamBackpressureChanged",
    "StreamTerminated"
  ])
})

test("LayerGraphPanel publishes selected providers and graph snapshots to Inspector", async () => {
  const app = Desktop.make({
    id: "notes",
    providers: Desktop.provider(Desktop.Provider.Runtime.test),
    windows: Desktop.window("main", { title: "Notes" })
  })

  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const panel = yield* LayerGraphPanel
      return yield* panel.list()
    }).pipe(
      Effect.provide(
        Layer.provide(
          LayerGraphPanelLive(),
          Layer.merge(Desktop.runtime(app), InspectorSafetyPolicyLive())
        )
      )
    )
  )

  expect(snapshot.layerGraph.appId).toBe("notes")
  expect(snapshot.layerGraph.providers).toEqual({ runtime: "test", webview: "system" })
  expect(snapshot.layerGraph.providerFacts).toEqual([
    {
      id: "test",
      kind: "runtime",
      capabilities: ["FileSystem", "Path", "Terminal", "Stdio", "ChildProcessSpawner"]
    },
    {
      id: "system",
      kind: "webview",
      capabilities: ["WindowWebView", "AppProtocol"]
    }
  ])
  expect(snapshot.layerGraph.nodes.map((node) => node.id)).toContain("provider:runtime:test")
  expect(snapshot.layerGraph.failures).toEqual([])
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
              Layer.succeed(Process)(processes),
              InspectorSafetyPolicyLive()
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
  const telemetry = await Effect.runPromise(makeTelemetry({ now: () => 1_000 }))
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
      spanId: "child",
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
      Effect.provide(
        Layer.provide(
          DiagnosticsPanelsLive(),
          Layer.mergeAll(Layer.succeed(Telemetry)(telemetry), InspectorSafetyPolicyLive())
        )
      )
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
        Layer.provide(
          DiagnosticsPanelsLive(),
          Layer.mergeAll(Layer.succeed(Telemetry)(disabledTelemetry), InspectorSafetyPolicyLive())
        )
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
          Layer.provide(
            DiagnosticsPanelsLive(options),
            Layer.mergeAll(Layer.succeed(Telemetry)(telemetry), InspectorSafetyPolicyLive())
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
        Layer.provide(
          DiagnosticsPanelsLive({ maxRows: 1 }),
          Layer.mergeAll(Layer.succeed(Telemetry)(telemetry), InspectorSafetyPolicyLive())
        )
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
        Layer.provide(
          DiagnosticsPanelsLive({ maxRows: 1 }),
          Layer.mergeAll(Layer.succeed(Telemetry)(telemetry), InspectorSafetyPolicyLive())
        )
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
      Effect.provide(
        Layer.provide(
          PerformanceOverlayLive(),
          Layer.mergeAll(Layer.succeed(Telemetry)(telemetry), InspectorSafetyPolicyLive())
        )
      )
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
    makeProcess(registry, TEST_OWNER, {
      permissions: { spawn: ["echo"] }
    }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, fakeProcessSpawner))
  )

const fakeProcessSpawner = ChildProcessSpawner.make(() =>
  Effect.succeed(
    ChildProcessSpawner.makeHandle({
      all: Stream.empty,
      exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      pid: ChildProcessSpawner.ProcessId(55),
      stderr: Stream.empty,
      stdin: Sink.drain,
      stdout: Stream.empty,
      unref: Effect.succeed(Effect.void)
    })
  )
)

const makeWorkersFixture = async (): Promise<WorkersFixture> => {
  let timestamp = 1_000
  const registry = await Effect.runPromise(
    makeResourceRegistry({
      now: () => timestamp++,
      nextId: (now) => makeResourceId(`resource-${now}`)
    })
  )
  const permissions = await Effect.runPromise(makePermissionRegistry({ traceId: () => "trace" }))
  const runtime = await makeFakeRuntime()
  const worker = await Effect.runPromise(
    makeWorker(registry, permissions, TEST_OWNER, {
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
  const readSnapshot = Effect.gen(function* () {
    const devtools = yield* WorkersDevtools
    return yield* devtools.list()
  }).pipe(
    Effect.provide(
      Layer.provide(
        WorkersDevtoolsLive,
        Layer.mergeAll(Layer.succeed(Worker)(fixture.worker), InspectorSafetyPolicyLive())
      )
    )
  )

  return await Effect.runPromise(
    readSnapshot.pipe(
      Effect.flatMap((snapshot) =>
        predicate(snapshot)
          ? Effect.succeed(snapshot)
          : Effect.fail(new Error("snapshot did not match"))
      ),
      Effect.retry(Schedule.spaced("10 millis").pipe(Schedule.both(Schedule.recurs(50)))),
      Effect.mapError(() => new Error("devtools snapshot did not match"))
    )
  )
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

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.yieldNow
})
