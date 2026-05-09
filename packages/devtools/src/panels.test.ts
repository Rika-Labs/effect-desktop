import { expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"

import {
  ClusterPanel,
  ClusterPanelLive,
  EventLogPanel,
  EventLogPanelLive,
  LogsPanel,
  LogsPanelLive,
  makeReactivityTracker,
  makeWorkflowExecutionRegistry,
  ReactivityPanel,
  ReactivityPanelLive,
  ReactivityTracker,
  WorkflowExecutionRegistry,
  WorkflowsPanel,
  WorkflowsPanelLive,
  type WorkflowsPanelSnapshot
} from "./index.js"
import { WorkflowEngine } from "effect/unstable/workflow"
import { EventLog as EventLogNS } from "effect/unstable/eventlog"
import { Reactivity as ReactivityNS } from "effect/unstable/reactivity"

test("ClusterPanel returns disabled state", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const panel = yield* ClusterPanel
      return yield* panel.list()
    }).pipe(Effect.provide(ClusterPanelLive))
  )

  expect(result.enabled).toBe(false)
  expect(result.reason).toBe("cluster-not-enabled")
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
        Layer.provide(
          WorkflowsPanelLive(),
          Layer.mergeAll(
            Layer.succeed(WorkflowExecutionRegistry)(registry),
            WorkflowEngine.layerMemory
          )
        )
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
        Layer.provide(
          ReactivityPanelLive(),
          Layer.mergeAll(Layer.succeed(ReactivityTracker)(tracker), ReactivityNS.layer)
        )
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
    }).pipe(Effect.provide(LogsPanelLive({ levelFilter: "Info" })))
  )

  expect(result.levelFilter).toBe("Info")
  const messages = result.records.map((r) => r.message)
  expect(messages.some((m) => m.includes("hello from test"))).toBe(true)
  expect(messages.some((m) => m.includes("error from test"))).toBe(true)
  expect(messages.some((m) => m.includes("debug below filter"))).toBe(false)
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
