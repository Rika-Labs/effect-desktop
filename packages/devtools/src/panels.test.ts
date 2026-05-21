import { expect, test } from "bun:test"
import {
  DesktopObservability as CoreDesktopObservability,
  emptyInspectorSafetySummary,
  InspectorSafetyPolicyLive,
  LayerGraphSnapshot
} from "@orika/core"
import {
  Cause,
  Clock,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Schema,
  Stream
} from "effect"

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
  embeddedInspectorGate
} from "./index.js"
import { EventJournal, EventLog as EventLogNS } from "effect/unstable/eventlog"
import { TestRunner } from "effect/unstable/cluster"
import { KeyValueStore } from "effect/unstable/persistence"

const encodeJsonString = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

test("ClusterPanelDisabled returns disabled state", () => {
  const runtime = ManagedRuntime.make(ClusterPanelDisabled)
  return runtime.runPromise(
    Effect.gen(function* () {
      const panel = yield* ClusterPanel
      const result = yield* panel.list()

      expect(result.enabled).toBe(false)
      if (!result.enabled) {
        expect(result.reason).toBe("cluster-not-enabled")
      }
    })
  )
})

test("ClusterPanelLive reads Effect cluster services", () => {
  const runtime = ManagedRuntime.make(Layer.provide(ClusterPanelLive, TestRunner.layer))
  return runtime.runPromise(
    Effect.gen(function* () {
      const panel = yield* ClusterPanel
      const result = yield* panel.list()

      expect(result.enabled).toBe(true)
      if (result.enabled) {
        expect(result.activeEntityCount).toBe(0)
        expect(result.isShutdown).toBe(false)
      }
    })
  )
})

test("WorkflowExecutionRegistry tracks started and completed executions", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const now = 1_710_000_000_000
      const registry = yield* makeWorkflowExecutionRegistry({ now: () => now })

      yield* registry.record({
        tag: "Started",
        executionId: "exec-1",
        workflowName: "Ping",
        startedAt: now
      })
      yield* registry.record({
        tag: "Completed",
        executionId: "exec-1",
        endedAt: now + 100
      })

      const rows = yield* registry.list()

      expect(rows).toHaveLength(1)
      expect(rows[0]?.executionId).toBe("exec-1")
      expect(rows[0]?.workflowName).toBe("Ping")
      expect(rows[0]?.state).toBe("completed")
      expect(rows[0]?.durationMs).toEqual(Option.some(100))
    })
  ))

test("WorkflowsPanel snapshot counts running and completed executions", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const now = 1_710_000_000_000
      const registry = yield* makeWorkflowExecutionRegistry({ now: () => now })

      yield* registry.record({
        tag: "Started",
        executionId: "exec-a",
        workflowName: "A",
        startedAt: now
      })
      yield* registry.record({
        tag: "Started",
        executionId: "exec-b",
        workflowName: "B",
        startedAt: now
      })
      yield* registry.record({
        tag: "Completed",
        executionId: "exec-b",
        endedAt: now + 50
      })
      yield* registry.record({
        tag: "Failed",
        executionId: "exec-a",
        endedAt: now + 200,
        errorTag: "NetworkError"
      })

      const runtime = ManagedRuntime.make(
        Layer.provide(WorkflowsPanelLive(), Layer.succeed(WorkflowExecutionRegistry)(registry))
      )
      const snapshot = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const panel = yield* WorkflowsPanel
            return yield* panel.list()
          })
        )
      )

      expect(snapshot.runningCount).toBe(0)
      expect(snapshot.completedCount).toBe(1)
      expect(snapshot.failedCount).toBe(1)
      expect(snapshot.executions.find((e) => e.executionId === "exec-a")?.errorTag).toEqual(
        Option.some("NetworkError")
      )
    })
  ))

test("WorkflowsPanel observes registry changes without polling", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const now = 1_710_000_000_000
      const registry = yield* makeWorkflowExecutionRegistry({ now: () => now })

      const runtime = ManagedRuntime.make(
        Layer.provide(WorkflowsPanelLive(), Layer.succeed(WorkflowExecutionRegistry)(registry))
      )
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const panel = yield* WorkflowsPanel
            const snapshots = yield* panel
              .observe()
              .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

            yield* Effect.sleep("0 millis")
            yield* registry.record({
              tag: "Started",
              executionId: "exec-push",
              workflowName: "PushWorkflow",
              startedAt: now
            })

            return yield* Fiber.join(snapshots).pipe(Effect.timeoutOption("20 millis"))
          })
        )
      )

      expect(Option.isSome(result)).toBe(true)
      const snapshots = Option.getOrThrow(result)
      expect(snapshots[0]?.executions).toEqual([])
      expect(snapshots[1]?.executions[0]?.executionId).toBe("exec-push")
      expect(snapshots[1]?.runningCount).toBe(1)
    })
  ))

test("ReactivityTracker records invalidation events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const timestamp = 1_710_000_444_000
      const rows = yield* Effect.gen(function* () {
        const tracker = yield* makeReactivityTracker()
        yield* tracker.trackInvalidation(["key-a", "key-b"])
        yield* tracker.trackInvalidation({ users: ["user-1"] })
        return yield* tracker.list()
      }).pipe(Effect.provideService(Clock.Clock, fixedClock(timestamp)))

      expect(rows).toHaveLength(2)
      expect(rows[0]?.keys).toEqual(["key-a", "key-b"])
      expect(rows[0]?.timestampMs).toBe(timestamp)
      expect(rows[1]?.keys).toEqual(["users:user-1"])
      expect(rows[1]?.timestampMs).toBe(timestamp)
    })
  ))

test("ReactivityPanel snapshot aggregates unique keys", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const now = 1_710_000_000_000
      const tracker = yield* makeReactivityTracker({ now: () => now })

      yield* tracker.trackInvalidation(["key-a"])
      yield* tracker.trackInvalidation(["key-a", "key-b"])

      const runtime = ManagedRuntime.make(
        Layer.provide(ReactivityPanelLive(), Layer.succeed(ReactivityTracker)(tracker))
      )
      const snapshot = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const panel = yield* ReactivityPanel
            return yield* panel.list()
          })
        )
      )

      expect(snapshot.totalInvalidations).toBe(2)
      expect(snapshot.uniqueKeys).toEqual(["key-a", "key-b"])
    })
  ))

const logsPanelLayer = (options: Parameters<typeof LogsPanelLive>[0]) =>
  Layer.provide(LogsPanelLive(options), InspectorSafetyPolicyLive())

const logsPanelWithLoggerLayer = (options: Parameters<typeof LogsPanelLive>[0]) => {
  const panelLayer = logsPanelLayer(options)
  const loggerLayer = Layer.unwrap(Effect.map(LogsPanel.asEffect(), (panel) => panel.layer()))
  return Layer.merge(panelLayer, Layer.provide(loggerLayer, panelLayer))
}

test("LogsPanel captures log output via installed logger", () => {
  const runtime = ManagedRuntime.make(logsPanelWithLoggerLayer({ levelFilter: "Info" }))
  return runtime.runPromise(
    Effect.gen(function* () {
      yield* Effect.logInfo("hello from test")
      yield* Effect.logError("error from test")
      yield* Effect.logDebug("debug below filter")
      const panel = yield* LogsPanel
      const result = yield* panel.list()

      expect(result.levelFilter).toBe("Info")
      const messages = result.records.map((r) => r.message)
      expect(messages.some((m) => m.includes("hello from test"))).toBe(true)
      expect(messages.some((m) => m.includes("error from test"))).toBe(true)
      expect(messages.some((m) => m.includes("debug below filter"))).toBe(false)
    })
  )
})

test("LogsPanel sanitizes logger text before buffering", () => {
  const runtime = ManagedRuntime.make(logsPanelWithLoggerLayer({ levelFilter: "Info" }))
  return runtime.runPromise(
    Effect.gen(function* () {
      yield* Effect.logInfo("api_key=secret-key")
      const panel = yield* LogsPanel
      const result = yield* panel.list()

      expect(encodeJsonString(result)).not.toContain("secret-key")
      expect(result.records[0]?.message).toContain("<redacted>")
      expect(result.records[0]?.safety.redacted).toBeGreaterThan(0)
    })
  )
})

test("LogsPanel observe emits initial snapshot and scheduled refresh", () => {
  const runtime = ManagedRuntime.make(
    logsPanelWithLoggerLayer({ levelFilter: "Info", frameInterval: "1 millis" })
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const panel = yield* LogsPanel
      const snapshots = yield* panel
        .observe()
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

      yield* Effect.yieldNow
      yield* Effect.logInfo("scheduled refresh")

      const result = yield* Fiber.join(snapshots).pipe(Effect.timeoutOption("100 millis"))

      expect(Option.isSome(result)).toBe(true)
      const records = Option.getOrThrow(result)
      expect(records[0]?.records).toEqual([])
      expect(
        records[1]?.records.some((record) => record.message.includes("scheduled refresh"))
      ).toBe(true)
    })
  )
})

test("EventLogPanel lists entries from an empty journal", () => {
  const fakeEventLog = EventLogNS.EventLog.of({
    entries: Effect.succeed([] as const),
    write: () => Effect.die("not implemented"),
    destroy: Effect.succeed(undefined as void)
  })

  const runtime = ManagedRuntime.make(
    Layer.provide(
      EventLogPanelLive({ maxRows: 10 }),
      Layer.succeed(EventLogNS.EventLog)(fakeEventLog)
    )
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const panel = yield* EventLogPanel
      const result = yield* panel.list()

      expect(result.totalCount).toBe(0)
      expect(result.entries).toHaveLength(0)
    })
  )
})

test("EventLogPanel reports journal read failures as typed errors", () => {
  const journalError = new EventJournal.EventJournalError({
    method: "entries",
    cause: new Error("journal unavailable")
  })
  const fakeEventLog = EventLogNS.EventLog.of({
    entries: Effect.fail(journalError),
    write: () => Effect.die("not implemented"),
    destroy: Effect.succeed(undefined as void)
  })

  const runtime = ManagedRuntime.make(
    Layer.provide(
      EventLogPanelLive({ maxRows: 10 }),
      Layer.succeed(EventLogNS.EventLog)(fakeEventLog)
    )
  )
  return runtime
    .runPromiseExit(
      Effect.gen(function* () {
        const panel = yield* EventLogPanel
        return yield* panel.list()
      })
    )
    .then((exit) => {
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const fail = exit.cause.reasons.find(Cause.isFailReason)
        expect(fail?.error).toBe(journalError)
      }
    })
})

test("PersistencePanel reports key-value store size and health", () => {
  const runtime = ManagedRuntime.make(
    Layer.provide(PersistencePanelLive(), KeyValueStore.layerMemory)
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const panel = yield* PersistencePanel
      const result = yield* panel.list()

      expect(result.kvHealthy).toBe(true)
      expect(result.kvSize).toEqual(Option.some(0))
      expect(result.kvError).toEqual(Option.none())
    })
  )
})

test("PersistencePanel reports typed key-value store failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const storeError = new KeyValueStore.KeyValueStoreError({
        method: "size",
        message: "store unavailable"
      })
      const failingStore = KeyValueStore.makeStringOnly({
        get: () => Effect.sync((): string | undefined => undefined),
        set: () => Effect.void,
        remove: () => Effect.void,
        clear: Effect.void,
        size: Effect.fail(storeError)
      })

      const runtime = ManagedRuntime.make(
        Layer.provide(
          PersistencePanelLive(),
          Layer.succeed(KeyValueStore.KeyValueStore)(failingStore)
        )
      )
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const panel = yield* PersistencePanel
            return yield* panel.list()
          })
        )
      )

      expect(result.kvHealthy).toBe(false)
      expect(result.kvSize).toEqual(Option.none())
      expect(result.kvError).toEqual(Option.some("size: store unavailable"))
    })
  ))

test("EmbeddedInspectorPanel is disabled by default", () => {
  let exports = 0
  const runtime = ManagedRuntime.make(
    Layer.provide(
      EmbeddedInspectorPanelLive({ snapshotClient: snapshotClient(() => exports++) }),
      Layer.mergeAll(
        InspectorSafetyPolicyLive(),
        Layer.succeed(DevtoolsSnapshotClient)(snapshotClient(() => exports++))
      )
    )
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const panel = yield* EmbeddedInspectorPanel
      const result = yield* panel.list()

      expect(result.enabled).toBe(false)
      expect(result.reason).toBe("disabled")
      expect(Option.isNone(result.views)).toBe(true)
      expect(exports).toBe(0)
    })
  )
})

test("EmbeddedInspectorPanel rejects embedded devtools in production", () => {
  let exports = 0
  const runtime = ManagedRuntime.make(
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
  return runtime.runPromise(
    Effect.gen(function* () {
      const panel = yield* EmbeddedInspectorPanel
      const result = yield* panel.list()

      expect(result.enabled).toBe(false)
      expect(result.reason).toBe("production-disabled")
      expect(exports).toBe(0)
    })
  )
})

test("EmbeddedInspectorPanel exposes shared Inspector views from the snapshot client", () => {
  const runtime = ManagedRuntime.make(
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
  return runtime.runPromise(
    Effect.gen(function* () {
      const observability = yield* CoreDesktopObservability
      const panel = yield* EmbeddedInspectorPanel
      const snapshot = yield* panel.list()

      expect(observability.mode).toBe("embedded-devtools")
      expect(Option.isSome(observability.transport)).toBe(true)
      expect(snapshot.enabled).toBe(true)
      expect(snapshot.reason).toBe("enabled")
      expect(Option.isSome(snapshot.views)).toBe(true)
      if (Option.isSome(snapshot.views)) {
        expect(snapshot.views.value.panels.map((p) => p.id)).toEqual([
          "live-runtime",
          "diagnostics",
          "performance",
          "event-log",
          "workflows",
          "reactivity",
          "persistence",
          "logs"
        ])
        expect(snapshot.views.value.panels.find((p) => p.id === "event-log")?.snapshot).toEqual({
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
  )
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
      providers: { runtime: "test", webview: "system" },
      nodes: [],
      providerFacts: [],
      failures: []
    }),
    safety: emptyInspectorSafetySummary
  },
  safety: emptyInspectorSafetySummary
}

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.yieldNow
})
