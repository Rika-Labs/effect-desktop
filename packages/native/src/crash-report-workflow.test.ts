import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer, ManagedRuntime, Option, Schedule, Schema } from "effect"
import { TestClock } from "effect/testing"
import { EventJournal, EventLog as EL, EventLogEncryption } from "effect/unstable/eventlog"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { PersistedQueue } from "effect/unstable/persistence"
import { WorkflowEngine } from "effect/unstable/workflow"

import { CrashReporterBreadcrumbInput } from "./contracts/crash-reporter.js"
import {
  CrashReport,
  CrashReportDrainConfigError,
  CrashReportGroupLayer,
  CrashReportReactivityLayer,
  CrashSubmissionWorkflow,
  crashReportRateLimitIntervalMs,
  makeCrashReportDrainLayer,
  makeCrashReportQueue,
  makeCrashReportQueueUploadHandler,
  makeCrashSubmissionWorkflowLayer
} from "./crash-report-workflow.js"

class CrashReportWaitingError extends Schema.TaggedErrorClass<CrashReportWaitingError>(
  "CrashReportWaitingError"
)("CrashReportWaitingError", {
  message: Schema.String
}) {}

const makeTestReport = (id: string): CrashReport =>
  new CrashReport({
    id,
    breadcrumbs: [
      { category: "navigation", message: "page loaded" },
      { category: "error", message: "unhandled exception" }
    ],
    capturedAt: 1_710_000_000_000
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

test("CrashReport schema round-trips a report with breadcrumbs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const report = makeTestReport("test-id-1")
      const encoded = yield* Schema.encodeUnknownEffect(CrashReport)(report)
      const decoded = yield* Schema.decodeUnknownEffect(CrashReport)(encoded)
      expect(decoded.id).toBe("test-id-1")
      expect(decoded.breadcrumbs).toHaveLength(2)
      expect(decoded.breadcrumbs[0]?.category).toBe("navigation")
    })
  ))

test("CrashReport rejects invalid capture timestamps", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const capturedAt of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
        const exit = yield* Effect.exit(
          Schema.decodeUnknownEffect(CrashReport)({
            id: "invalid-timestamp",
            breadcrumbs: [],
            capturedAt
          })
        )

        expect(Exit.isFailure(exit)).toBe(true)
      }
    })
  ))

test("CrashReporterBreadcrumbInput rejects invalid breadcrumb timestamps", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const timestamp of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
        const exit = yield* Effect.exit(
          Schema.decodeUnknownEffect(CrashReporterBreadcrumbInput)({
            category: "error",
            message: "boom",
            timestamp
          })
        )

        expect(Exit.isFailure(exit)).toBe(true)
      }
    })
  ))

test("PersistedQueue deduplicates reports with the same id", () => {
  const report = makeTestReport("dedup-test-1")
  const runtime = ManagedRuntime.make(queueLayer)
  return runtime.runPromise(
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
    })
  )
})

test("CrashReport queue upload handler enqueues flushed breadcrumbs", () => {
  const runtime = ManagedRuntime.make(queueLayer)
  return runtime.runPromise(
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
    })
  )
})

test("CrashReport queue upload handler rejects invalid capture timestamps before queueing", () => {
  const runtime = ManagedRuntime.make(queueLayer)
  return runtime.runPromise(
    Effect.gen(function* () {
      const handler = yield* makeCrashReportQueueUploadHandler({
        now: () => Number.NaN,
        id: () => "invalid-timestamp-report"
      })
      const exit = yield* Effect.exit(handler([{ category: "error", message: "boom" }]))
      const queue = yield* makeCrashReportQueue
      const queuedReport = yield* queue
        .take((report) => Effect.succeed(report))
        .pipe(Effect.timeoutOption("5 millis"))

      expect(Exit.isFailure(exit)).toBe(true)
      expect(Option.isNone(queuedReport)).toBe(true)
    })
  )
})

test("CrashReport drain consumes queued reports through the submission workflow", () => {
  const requests: Array<{ readonly method: string; readonly url: string }> = []
  const httpLayer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.sync(() => {
        requests.push({ method: request.method, url: url.toString() })
        return HttpClientResponse.fromWeb(request, new Response(null, { status: 200 }))
      })
    )
  )
  const layer = Layer.mergeAll(queueLayer, eventLogLayer, WorkflowEngine.layerMemory, httpLayer)
  const runtime = ManagedRuntime.make(layer)
  return runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* makeCrashReportQueue
        const log = yield* EL.EventLog
        const report = makeTestReport("drain-submit-1")

        yield* Layer.build(
          makeCrashReportDrainLayer({
            endpointUrl: "https://crash.example/reports",
            rateLimitPerHour: 3_600_000
          })
        )
        yield* queue.offer(report, { id: report.id })

        const entries = yield* log.entries.pipe(
          Effect.flatMap((entries) =>
            entries.some(
              (entry) => entry.event === "crash-report-submitted" && entry.primaryKey === report.id
            )
              ? Effect.succeed(entries)
              : Effect.fail(
                  new CrashReportWaitingError({ message: "waiting for crash report submission" })
                )
          ),
          Effect.retry(Schedule.spaced("5 millis").pipe(Schedule.both(Schedule.recurs(100))))
        )

        expect(requests).toEqual([{ method: "POST", url: "https://crash.example/reports" }])
        expect(entries.some((entry) => entry.event === "crash-report-dropped")).toBe(false)
      })
    )
  )
})

test("CrashSubmissionWorkflow records dropped reports after exhausted submit retries", () => {
  let attempts = 0
  const httpLayer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.sync(() => {
        attempts += 1
        return HttpClientResponse.fromWeb(
          request,
          new Response(null, {
            status: 503,
            statusText: `unavailable:${url.toString()}`
          })
        )
      })
    )
  )
  const layer = makeCrashSubmissionWorkflowLayer("https://crash.example/reports").pipe(
    Layer.provideMerge(eventLogLayer),
    Layer.provideMerge(WorkflowEngine.layerMemory),
    Layer.provideMerge(httpLayer),
    Layer.provideMerge(TestClock.layer())
  )
  const runtime = ManagedRuntime.make(layer)
  return runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const report = makeTestReport("drop-submit-1")
        const log = yield* EL.EventLog
        const fiber = yield* CrashSubmissionWorkflow.execute(report).pipe(Effect.forkChild)

        yield* Effect.yieldNow
        yield* TestClock.adjust("1 hour")
        yield* Fiber.join(fiber)

        const entries = yield* log.entries
        expect(attempts).toBe(11)
        expect(
          entries.some(
            (entry) => entry.event === "crash-report-dropped" && entry.primaryKey === report.id
          )
        ).toBe(true)
        expect(
          entries.some(
            (entry) => entry.event === "crash-report-submitted" && entry.primaryKey === report.id
          )
        ).toBe(false)
      })
    )
  )
})

test("crashReportRateLimitIntervalMs rejects invalid rate limits", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const valid = yield* crashReportRateLimitIntervalMs(120)
      expect(valid).toBe(30_000)

      const exit = yield* Effect.exit(crashReportRateLimitIntervalMs(0))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        expect(Schema.is(CrashReportDrainConfigError)(failure?.error)).toBe(true)
      }
    })
  ))

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
