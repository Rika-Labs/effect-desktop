import { expect, test } from "bun:test"
import {
  DesktopObservability as CoreDesktopObservability,
  emptyInspectorSafetySummary,
  InspectorSafetyPolicyLive,
  LayerGraphSnapshot
} from "@effect-desktop/core"
import { Cause, Effect, Exit, Layer, Option } from "effect"

import {
  ClusterPanel,
  ClusterPanelDisabled,
  ClusterPanelLive,
  DesktopInspector,
  EmbeddedInspectorPanel,
  EmbeddedInspectorPanelLive,
  EventLogPanel,
  EventLogPanelLive,
  LogsPanel,
  LogsPanelLive,
  makeReactivityTracker,
  makeWorkflowExecutionRegistry,
  PersistencePanel,
  PersistencePanelLive,
  ReactivityPanel,
  ReactivityPanelLive,
  ReactivityTracker,
  DevtoolsSnapshotClient,
  WorkflowExecutionRegistry,
  WorkflowsPanel,
  WorkflowsPanelLive,
  type DevtoolsSnapshot,
  type DevtoolsSnapshotClientApi,
  type WorkflowsPanelSnapshot,
  embeddedInspectorGate
} from "./index.js"
import { EventJournal, EventLog as EventLogNS } from "effect/unstable/eventlog"
import { TestRunner } from "effect/unstable/cluster"
import { KeyValueStore } from "effect/unstable/persistence"

test("ClusterPanelDisabled returns disabled state", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const panel = yield* ClusterPanel
      return yield* panel.list()
    }).pipe(Effect.provide(ClusterPanelDisabled))
  )

  expect(result.enabled).toBe(false)
  if (!result.enabled) {
    expect(result.reason).toBe("cluster-not-enabled")
  }
})

test("ClusterPanelLive reads Effect cluster services", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const panel = yield* ClusterPanel
      return yield* panel.list()
    }).pipe(Effect.provide(ClusterPanelLive), Effect.provide(TestRunner.layer))
  )

  expect(result.enabled).toBe(true)
  if (result.enabled) {
    expect(result.activeEntityCount).toBe(0)
    expect(result.isShutdown).toBe(false)
  }
})

test("WorkflowExecutionRegistry tracks started and completed executions", async () => {
  const now = Date.now()
  const registry = await Effect.runPromise(makeWorkflowExecutionRegistry({ now: () => now }))

  await Effect.runPromise(
    registry.record({
      tag: "Started",
      executionId: "exec-1",
      workflowName: "Ping",
      startedAt: now
    })
  )
  await Effect.runPromise(
    registry.record({
      tag: "Completed",
      executionId: "exec-1",
      endedAt: now + 100
    })
  )

  const rows = await Effect.runPromise(registry.list())

  expect(rows).toHaveLength(1)
  expect(rows[0]?.executionId).toBe("exec-1")
  expect(rows[0]?.workflowName).toBe("Ping")
  expect(rows[0]?.state).toBe("completed")
  expect(rows[0]?.durationMs).toEqual(Option.some(100))
})

test("WorkflowsPanel snapshot counts running and completed executions", async () => {
  const now = Date.now()
  const registry = await Effect.runPromise(makeWorkflowExecutionRegistry({ now: () => now }))

  await Effect.runPromise(
    registry.record({ tag: "Started", executionId: "exec-a", workflowName: "A", startedAt: now })
  )
  await Effect.runPromise(
    registry.record({ tag: "Started", executionId: "exec-b", workflowName: "B", startedAt: now })
  )
  await Effect.runPromise(
    registry.record({ tag: "Completed", executionId: "exec-b", endedAt: now + 50 })
  )
  await Effect.runPromise(
    registry.record({
      tag: "Failed",
      executionId: "exec-a",
      endedAt: now + 200,
      errorTag: "NetworkError"
    })
  )

  const snapshot = (await Effect.runPromise(
    Effect.gen(function* () {
      const panel = yield* WorkflowsPanel
      return yield* panel.list()
    }).pipe(
      Effect.provide(
        Layer.provide(WorkflowsPanelLive(), Layer.succeed(WorkflowExecutionRegistry)(registry))
      )
    )
  )) as WorkflowsPanelSnapshot

  expect(snapshot.runningCount).toBe(0)
  expect(snapshot.completedCount).toBe(1)
  expect(snapshot.failedCount).toBe(1)
  expect(snapshot.executions.find((e) => e.executionId === "exec-a")?.errorTag).toEqual(
    Option.some("NetworkError")
  )
})

test("ReactivityTracker records invalidation events", async () => {
  const now = Date.now()
  const tracker = await Effect.runPromise(makeReactivityTracker({ now: () => now }))

  await Effect.runPromise(tracker.trackInvalidation(["key-a", "key-b"]))
  await Effect.runPromise(tracker.trackInvalidation({ users: ["user-1"] }))

  const rows = await Effect.runPromise(tracker.list())

  expect(rows).toHaveLength(2)
  expect(rows[0]?.keys).toEqual(["key-a", "key-b"])
  expect(rows[1]?.keys).toEqual(["users:user-1"])
})

test("ReactivityPanel snapshot aggregates unique keys", async () => {
  const now = Date.now()
  const tracker = await Effect.runPromise(makeReactivityTracker({ now: () => now }))

  await Effect.runPromise(tracker.trackInvalidation(["key-a"]))
  await Effect.runPromise(tracker.trackInvalidation(["key-a", "key-b"]))

  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const panel = yield* ReactivityPanel
      return yield* panel.list()
    }).pipe(
      Effect.provide(
        Layer.provide(ReactivityPanelLive(), Layer.succeed(ReactivityTracker)(tracker))
      )
    )
  )

  expect(snapshot.totalInvalidations).toBe(2)
  expect(snapshot.uniqueKeys).toEqual(["key-a", "key-b"])
})

test("LogsPanel captures log output via installed logger", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const panel = yield* LogsPanel
      const logLayer = panel.layer()
      yield* Effect.logInfo("hello from test").pipe(Effect.provide(logLayer))
      yield* Effect.logError("error from test").pipe(Effect.provide(logLayer))
      yield* Effect.logDebug("debug below filter").pipe(Effect.provide(logLayer))
      return yield* panel.list()
    }).pipe(
      Effect.provide(
        Layer.provide(LogsPanelLive({ levelFilter: "Info" }), InspectorSafetyPolicyLive())
      )
    )
  )

  expect(result.levelFilter).toBe("Info")
  const messages = result.records.map((r) => r.message)
  expect(messages.some((m) => m.includes("hello from test"))).toBe(true)
  expect(messages.some((m) => m.includes("error from test"))).toBe(true)
  expect(messages.some((m) => m.includes("debug below filter"))).toBe(false)
})

test("LogsPanel sanitizes logger text before buffering", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const panel = yield* LogsPanel
      const logLayer = panel.layer()
      yield* Effect.logInfo("api_key=secret-key").pipe(Effect.provide(logLayer))
      return yield* panel.list()
    }).pipe(
      Effect.provide(
        Layer.provide(LogsPanelLive({ levelFilter: "Info" }), InspectorSafetyPolicyLive())
      )
    )
  )

  expect(JSON.stringify(result)).not.toContain("secret-key")
  expect(result.records[0]?.message).toContain("<redacted>")
  expect(result.records[0]?.safety.redacted).toBeGreaterThan(0)
})

test("EventLogPanel lists entries from an empty journal", async () => {
  const fakeEventLog = EventLogNS.EventLog.of({
    entries: Effect.succeed([] as const),
    write: () => Effect.die("not implemented"),
    destroy: Effect.void
  })

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const panel = yield* EventLogPanel
      return yield* panel.list()
    }).pipe(
      Effect.provide(
        Layer.provide(
          EventLogPanelLive({ maxRows: 10 }),
          Layer.succeed(EventLogNS.EventLog)(fakeEventLog)
        )
      )
    )
  )

  expect(result.totalCount).toBe(0)
  expect(result.entries).toHaveLength(0)
})

test("EventLogPanel reports journal read failures as typed errors", async () => {
  const journalError = new EventJournal.EventJournalError({
    method: "entries",
    cause: new Error("journal unavailable")
  })
  const fakeEventLog = EventLogNS.EventLog.of({
    entries: Effect.fail(journalError),
    write: () => Effect.die("not implemented"),
    destroy: Effect.void
  })

  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const panel = yield* EventLogPanel
      return yield* panel.list()
    }).pipe(
      Effect.provide(
        Layer.provide(
          EventLogPanelLive({ maxRows: 10 }),
          Layer.succeed(EventLogNS.EventLog)(fakeEventLog)
        )
      )
    )
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)
    expect(fail?.error).toBe(journalError)
  }
})

test("PersistencePanel reports key-value store size and health", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const panel = yield* PersistencePanel
      return yield* panel.list()
    }).pipe(Effect.provide(Layer.provide(PersistencePanelLive(), KeyValueStore.layerMemory)))
  )

  expect(result.kvHealthy).toBe(true)
  expect(result.kvSize).toEqual(Option.some(0))
  expect(result.kvError).toEqual(Option.none())
})

test("PersistencePanel reports typed key-value store failures", async () => {
  const storeError = new KeyValueStore.KeyValueStoreError({
    method: "size",
    message: "store unavailable"
  })
  const failingStore = KeyValueStore.makeStringOnly({
    get: () => Effect.succeed(undefined),
    set: () => Effect.void,
    remove: () => Effect.void,
    clear: Effect.void,
    size: Effect.fail(storeError)
  })

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const panel = yield* PersistencePanel
      return yield* panel.list()
    }).pipe(
      Effect.provide(
        Layer.provide(
          PersistencePanelLive(),
          Layer.succeed(KeyValueStore.KeyValueStore)(failingStore)
        )
      )
    )
  )

  expect(result.kvHealthy).toBe(false)
  expect(result.kvSize).toEqual(Option.none())
  expect(result.kvError).toEqual(Option.some("size: store unavailable"))
})

test("EmbeddedInspectorPanel is disabled by default", async () => {
  let exports = 0
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const panel = yield* EmbeddedInspectorPanel
      return yield* panel.list()
    }).pipe(
      Effect.provide(
        Layer.provide(
          EmbeddedInspectorPanelLive({ snapshotClient: snapshotClient(() => exports++) }),
          Layer.mergeAll(
            InspectorSafetyPolicyLive(),
            Layer.succeed(DevtoolsSnapshotClient)(snapshotClient(() => exports++))
          )
        )
      )
    )
  )

  expect(result.enabled).toBe(false)
  expect(result.reason).toBe("disabled")
  expect(Option.isNone(result.views)).toBe(true)
  expect(exports).toBe(0)
})

test("EmbeddedInspectorPanel rejects embedded devtools in production", async () => {
  let exports = 0
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const panel = yield* EmbeddedInspectorPanel
      return yield* panel.list()
    }).pipe(
      Effect.provide(
        Layer.provide(
          EmbeddedInspectorPanelLive({
            mode: "embedded-devtools",
            profile: "production",
            snapshotClient: snapshotClient(() => exports++)
          }),
          Layer.mergeAll(
            InspectorSafetyPolicyLive(),
            Layer.succeed(DevtoolsSnapshotClient)(snapshotClient(() => exports++))
          )
        )
      )
    )
  )

  expect(result.enabled).toBe(false)
  expect(result.reason).toBe("production-disabled")
  expect(exports).toBe(0)
})

test("EmbeddedInspectorPanel exposes shared Inspector views from the snapshot client", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const observability = yield* CoreDesktopObservability
      const panel = yield* EmbeddedInspectorPanel
      const snapshot = yield* panel.list()
      return { observability, snapshot }
    }).pipe(
      Effect.provide(
        Layer.provide(
          DesktopInspector.layer({
            mode: "embedded-devtools",
            snapshotClient: snapshotClient((count) => count)
          }),
          Layer.mergeAll(
            InspectorSafetyPolicyLive(),
            Layer.succeed(DevtoolsSnapshotClient)(snapshotClient((count) => count))
          )
        )
      )
    )
  )

  expect(result.observability.mode).toBe("embedded-devtools")
  expect(Option.isSome(result.observability.transport)).toBe(true)
  expect(result.snapshot.enabled).toBe(true)
  expect(result.snapshot.reason).toBe("enabled")
  expect(Option.isSome(result.snapshot.views)).toBe(true)
  if (Option.isSome(result.snapshot.views)) {
    expect(result.snapshot.views.value.panels.map((panel) => panel.id)).toEqual([
      "live-runtime",
      "diagnostics",
      "performance",
      "event-log",
      "workflows",
      "reactivity",
      "persistence",
      "logs"
    ])
    expect(
      result.snapshot.views.value.panels.find((panel) => panel.id === "event-log")?.snapshot
    ).toEqual({
      entries: [
        {
          event: "test.event",
          id: "event-1",
          payloadBytes: 7,
          primaryKey: "app",
          timestampMs: 1
        }
      ],
      totalCount: 1
    })
  }
})

test("embeddedInspectorGate is opt-in and development-only", () => {
  expect(embeddedInspectorGate({ mode: "disabled", profile: "development" })).toEqual({
    enabled: false,
    reason: "disabled"
  })
  expect(embeddedInspectorGate({ mode: "embedded-devtools", profile: "production" })).toEqual({
    enabled: false,
    reason: "production-disabled"
  })
  expect(embeddedInspectorGate({ mode: "embedded-devtools", profile: "development" })).toEqual({
    enabled: true,
    reason: "enabled"
  })
})

const snapshotClient = (mark: (count: number) => number): DevtoolsSnapshotClientApi => {
  let count = 0
  return {
    exportSnapshot: () =>
      Effect.sync(() => {
        count += 1
        mark(count)
        return devtoolsSnapshot
      })
  }
}

const devtoolsSnapshot: DevtoolsSnapshot = {
  liveRuntime: {
    bridgeCalls: [],
    streams: [],
    resources: [],
    permissions: [],
    processes: [],
    safety: emptyInspectorSafetySummary
  },
  diagnostics: {
    logs: [],
    traces: [],
    metrics: [],
    safety: emptyInspectorSafetySummary
  },
  performance: {
    startup: [],
    bridgeP99: [],
    renderFrame: {
      id: "renderer.frame",
      label: "Renderer frame",
      valueMs: Option.none(),
      budgetMs: 16.7,
      ratio: Option.none(),
      status: "missing",
      samples: []
    },
    safety: emptyInspectorSafetySummary
  },
  eventLog: {
    entries: [
      {
        event: "test.event",
        id: "event-1",
        payloadBytes: 7,
        primaryKey: "app",
        timestampMs: 1
      }
    ],
    totalCount: 1
  },
  workflows: {
    executions: [],
    runningCount: 0,
    completedCount: 0,
    failedCount: 0
  },
  reactivity: {
    invalidations: [],
    totalInvalidations: 0,
    uniqueKeys: []
  },
  persistence: {
    kvSize: Option.none(),
    kvHealthy: true,
    kvError: Option.none()
  },
  logs: {
    records: [],
    totalCount: 0,
    levelFilter: "Info",
    safety: emptyInspectorSafetySummary
  },
  cluster: {
    enabled: false,
    reason: "cluster-not-enabled"
  },
  layerGraph: {
    layerGraph: new LayerGraphSnapshot({
      appId: "test",
      providers: { runtime: "test" },
      nodes: [],
      providerFacts: [],
      failures: []
    }),
    safety: emptyInspectorSafetySummary
  },
  safety: emptyInspectorSafetySummary
}
