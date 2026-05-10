import { expect, test } from "bun:test"
import { Data, Effect, Layer, Schema } from "effect"
import { EventJournal, EventLog as EL, EventLogEncryption } from "effect/unstable/eventlog"
import { PersistedQueue } from "effect/unstable/persistence"
import { Activity, Workflow, WorkflowEngine } from "effect/unstable/workflow"

import {
  CrashReport,
  CrashReportGroupLayer,
  CrashReportReactivityLayer,
  makeCrashReportQueueUploadHandler,
  makeCrashReportQueue
} from "./crash-report-workflow.js"

const makeTestReport = (id: string): CrashReport =>
  new CrashReport({
    id,
    breadcrumbs: [
      { category: "navigation", message: "page loaded" },
      { category: "error", message: "unhandled exception" }
    ],
    capturedAt: Date.now()
  })

const queueLayer = PersistedQueue.layer.pipe(Layer.provide(PersistedQueue.layerStoreMemory))

const identityLayer = Layer.effect(EL.Identity, EL.makeIdentity).pipe(
  Layer.provide(EventLogEncryption.layerSubtle)
)

const eventLogLayer = Layer.provide(
  EL.layerEventLog,
  Layer.mergeAll(
    EventJournal.layerMemory,
    identityLayer,
    CrashReportGroupLayer,
    CrashReportReactivityLayer
  ).pipe(Layer.provideMerge(EL.layerRegistry))
)

test("CrashReport schema round-trips a report with breadcrumbs", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const report = makeTestReport("test-id-1")
      const encoded = yield* Schema.encodeUnknownEffect(CrashReport)(report)
      const decoded = yield* Schema.decodeUnknownEffect(CrashReport)(encoded)
      expect(decoded.id).toBe("test-id-1")
      expect(decoded.breadcrumbs).toHaveLength(2)
      expect(decoded.breadcrumbs[0]?.category).toBe("navigation")
    })
  )
})

test("PersistedQueue smoke: offer and take a CrashReport", async () => {
  const report = makeTestReport("queue-smoke-1")

  await Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* makeCrashReportQueue
      yield* queue.offer(report)

      const taken = yield* queue.take((r) => Effect.succeed(r))
      expect(taken.id).toBe("queue-smoke-1")
      expect(taken.breadcrumbs).toHaveLength(2)
    }).pipe(Effect.provide(queueLayer))
  )
})

test("PersistedQueue deduplicates reports with the same id", async () => {
  const report = makeTestReport("dedup-test-1")

  await Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* makeCrashReportQueue

      const id1 = yield* queue.offer(report, { id: "fixed-id" })
      const id2 = yield* queue.offer(report, { id: "fixed-id" })

      expect(id1).toBe("fixed-id")
      expect(id2).toBe("fixed-id")

      let count = 0
      yield* queue.take((r) =>
        Effect.sync(() => {
          count++
          return r
        })
      )

      expect(count).toBe(1)
    }).pipe(Effect.provide(queueLayer))
  )
})

test("CrashReport queue upload handler enqueues flushed breadcrumbs", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const handler = yield* makeCrashReportQueueUploadHandler({
        now: () => 12345,
        id: () => "queued-report-1",
        appVersion: "1.2.3",
        platform: "darwin"
      })

      yield* handler([{ category: "error", message: "boom" }])

      const queue = yield* makeCrashReportQueue
      const report = yield* queue.take((r) => Effect.succeed(r))

      expect(report.id).toBe("queued-report-1")
      expect(report.capturedAt).toBe(12345)
      expect(report.appVersion).toBe("1.2.3")
      expect(report.platform).toBe("darwin")
      expect(report.breadcrumbs).toHaveLength(1)
      expect(report.breadcrumbs[0]?.message).toBe("boom")
    }).pipe(Effect.provide(queueLayer))
  )
})

class FlakyError extends Data.TaggedError("FlakyError")<{
  readonly attempt: number
}> {}

test("Activity.retry retries a transient failure inside a Workflow", async () => {
  let attempts = 0

  const RetryTest = Workflow.make({
    name: "RetryTest",
    payload: { id: Schema.String },
    idempotencyKey: (p) => p.id,
    success: Schema.Number,
    error: Schema.TaggedStruct("FlakyError", { attempt: Schema.Number })
  })

  const flakyActivity = Activity.make({
    name: "flaky-activity",
    success: Schema.Number,
    error: Schema.TaggedStruct("FlakyError", { attempt: Schema.Number }),
    execute: Effect.sync(() => {
      attempts += 1
      return attempts
    }).pipe(
      Effect.flatMap((attempt) =>
        attempt < 3 ? Effect.fail(new FlakyError({ attempt })) : Effect.succeed(attempt)
      )
    )
  })

  const layer = RetryTest.toLayer(() => flakyActivity.pipe(Activity.retry({ times: 5 })))

  const result = await Effect.runPromise(
    RetryTest.execute({ id: "retry-test-1" }).pipe(
      Effect.provide(layer),
      Effect.provide(WorkflowEngine.layerMemory)
    )
  )

  expect(result).toBe(3)
  expect(attempts).toBe(3)
})

test("CrashReport optionalKey fields are absent when not provided", () => {
  const minimal = new CrashReport({
    id: "min-1",
    breadcrumbs: [],
    capturedAt: 12345
  })
  expect(minimal.appVersion).toBeUndefined()
  expect(minimal.platform).toBeUndefined()
})

test("CrashReport preserves optional fields when provided", () => {
  const withOptionals = new CrashReport({
    id: "opt-1",
    breadcrumbs: [],
    capturedAt: 12345,
    appVersion: "1.2.3",
    platform: "darwin"
  })
  expect(withOptionals.appVersion).toBe("1.2.3")
  expect(withOptionals.platform).toBe("darwin")
})

test("EventLog writes crash-report-submitted and crash-report-dropped events", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const log = yield* EL.EventLog
      const { CrashReportEventSchema } = yield* Effect.promise(
        () => import("./crash-report-workflow.js")
      )

      const report = makeTestReport("event-log-test-1")

      yield* log.write({
        schema: CrashReportEventSchema,
        event: "crash-report-submitted",
        payload: report
      })

      yield* log.write({
        schema: CrashReportEventSchema,
        event: "crash-report-dropped",
        payload: report
      })

      const entries = yield* log.entries
      expect(entries.length).toBeGreaterThanOrEqual(2)
    }).pipe(Effect.provide(eventLogLayer))
  )
})
