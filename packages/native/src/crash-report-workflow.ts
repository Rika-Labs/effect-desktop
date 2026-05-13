import { makeHostProtocolInvalidStateError } from "@effect-desktop/bridge"
import { DesktopSchedules } from "@effect-desktop/core"
import { Clock, Effect, Layer, Random, Schema } from "effect"
import { EventGroup, EventJournal, EventLog } from "effect/unstable/eventlog"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse
} from "effect/unstable/http"
import { PersistedQueue } from "effect/unstable/persistence"
import { Activity, Workflow, WorkflowEngine } from "effect/unstable/workflow"

import type { CrashReportUploadHandler } from "./crash-reporter.js"
import { CrashReporterBreadcrumbInput } from "./contracts/crash-reporter.js"

export class CrashReport extends Schema.Class<CrashReport>("CrashReport")({
  id: Schema.String,
  breadcrumbs: Schema.Array(CrashReporterBreadcrumbInput),
  capturedAt: Schema.Number,
  appVersion: Schema.optionalKey(Schema.String),
  platform: Schema.optionalKey(Schema.String)
}) {}

export class CrashReportSubmitError extends Schema.ErrorClass<CrashReportSubmitError>(
  "CrashReportSubmitError"
)({
  _tag: Schema.tag("CrashReportSubmitError"),
  status: Schema.Number,
  message: Schema.String
}) {}

export class CrashReportDrainConfigError extends Schema.ErrorClass<CrashReportDrainConfigError>(
  "CrashReportDrainConfigError"
)({
  _tag: Schema.tag("CrashReportDrainConfigError"),
  field: Schema.String,
  message: Schema.String
}) {}

const submitError = (status: number, message: string): CrashReportSubmitError =>
  new CrashReportSubmitError({ status, message })

const crashReportGroup = EventGroup.empty
  .add({
    tag: "crash-report-submitted",
    primaryKey: (p: unknown) => (p as CrashReport).id,
    payload: CrashReport
  })
  .add({
    tag: "crash-report-dropped",
    primaryKey: (p: unknown) => (p as CrashReport).id,
    payload: CrashReport
  })

export const CrashReportEventSchema = EventLog.schema(crashReportGroup)

export const CrashReportGroupLayer = EventLog.group(crashReportGroup, (handlers) =>
  handlers
    .handle("crash-report-submitted", () => Effect.void)
    .handle("crash-report-dropped", () => Effect.void)
)

export const CrashReportReactivityLayer = EventLog.groupReactivity(crashReportGroup, [
  "crash-reports"
])

export const CrashSubmissionWorkflow = Workflow.make({
  name: "CrashSubmission",
  payload: CrashReport,
  idempotencyKey: (p) => p.id,
  error: CrashReportSubmitError
})

const makeCrashSubmitActivity = (report: CrashReport, endpointUrl: string) =>
  Activity.make({
    name: "crash-submit-http",
    error: CrashReportSubmitError,
    execute: HttpClientRequest.post(endpointUrl).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        id: report.id,
        capturedAt: report.capturedAt,
        breadcrumbs: report.breadcrumbs,
        ...(report.appVersion === undefined ? {} : { appVersion: report.appVersion }),
        ...(report.platform === undefined ? {} : { platform: report.platform })
      }),
      HttpClient.execute,
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.asVoid,
      Effect.retry({ schedule: DesktopSchedules.crashReportSubmission }),
      Effect.catch((e: HttpClientError.HttpClientError) =>
        Effect.fail(
          submitError(
            e.response?.status ?? 0,
            e.response === undefined ? e.message : `HTTP ${String(e.response.status)}`
          )
        )
      )
    )
  })

const mapAuditError = (error: EventJournal.EventJournalError): CrashReportSubmitError =>
  submitError(0, `EventLog.${error.method} failed`)

const writeCrashReportEvent = (
  log: EventLog.EventLog["Service"],
  event: "crash-report-submitted" | "crash-report-dropped",
  report: CrashReport
): Effect.Effect<void, CrashReportSubmitError, never> =>
  log
    .write({
      schema: CrashReportEventSchema,
      event,
      payload: report
    })
    .pipe(Effect.mapError(mapAuditError))

export interface CrashReportQueueUploadHandlerOptions {
  readonly now?: () => number
  readonly id?: () => string
  readonly appVersion?: string
  readonly platform?: string
}

export const makeCrashReportQueueUploadHandler = (
  options: CrashReportQueueUploadHandlerOptions = {}
): Effect.Effect<CrashReportUploadHandler, never, PersistedQueue.PersistedQueueFactory> =>
  Effect.gen(function* () {
    const queue = yield* makeCrashReportQueue
    const now = options.now === undefined ? Clock.currentTimeMillis : Effect.sync(options.now)

    return (breadcrumbs) =>
      Effect.gen(function* () {
        const capturedAt = yield* now
        const id =
          options.id === undefined
            ? `crash-${String(capturedAt)}-${yield* Random.nextUUIDv4}`
            : options.id()
        const report = new CrashReport({
          id,
          breadcrumbs,
          capturedAt,
          ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
          ...(options.platform === undefined ? {} : { platform: options.platform })
        })
        yield* queue.offer(report, { id }).pipe(
          Effect.asVoid,
          Effect.mapError((error) =>
            makeHostProtocolInvalidStateError(
              "queue-offer-failed",
              error instanceof Error ? error.message : String(error),
              "CrashReporter.flush"
            )
          )
        )
      })
  })

export const makeCrashSubmissionWorkflowLayer = (endpointUrl: string) =>
  CrashSubmissionWorkflow.toLayer((report) =>
    Effect.gen(function* () {
      const log = yield* EventLog.EventLog
      const activity = makeCrashSubmitActivity(report, endpointUrl)
      yield* activity.pipe(
        Effect.matchEffect({
          onSuccess: () => writeCrashReportEvent(log, "crash-report-submitted", report),
          onFailure: (_e) => writeCrashReportEvent(log, "crash-report-dropped", report)
        })
      )
    })
  )

export const makeCrashReportQueue: Effect.Effect<
  PersistedQueue.PersistedQueue<CrashReport, never>,
  never,
  PersistedQueue.PersistedQueueFactory
> = PersistedQueue.make({ name: "crash-reports", schema: CrashReport })

export const crashReportRateLimitIntervalMs = (
  perHour: number
): Effect.Effect<number, CrashReportDrainConfigError, never> =>
  Number.isFinite(perHour) && perHour > 0
    ? Effect.succeed(Math.ceil((60 * 60 * 1000) / perHour))
    : Effect.fail(
        new CrashReportDrainConfigError({
          field: "rateLimitPerHour",
          message: "rateLimitPerHour must be a positive finite number"
        })
      )

const rateGuard = (intervalMs: number): Effect.Effect<void, never, never> =>
  Effect.sleep(intervalMs)

export const makeCrashReportDrainLayer = (options: {
  readonly endpointUrl: string
  readonly rateLimitPerHour: number
}): Layer.Layer<
  never,
  CrashReportDrainConfigError,
  | PersistedQueue.PersistedQueueFactory
  | WorkflowEngine.WorkflowEngine
  | EventLog.EventLog
  | EventLog.Registry
  | HttpClient.HttpClient
> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const intervalMs = yield* crashReportRateLimitIntervalMs(options.rateLimitPerHour)
      const queue = yield* makeCrashReportQueue

      yield* Effect.forever(
        queue.take((report, _meta) =>
          Effect.gen(function* () {
            yield* rateGuard(intervalMs)
            yield* CrashSubmissionWorkflow.execute(report, { discard: true })
          })
        )
      ).pipe(
        Effect.provide(makeCrashSubmissionWorkflowLayer(options.endpointUrl)),
        Effect.forkScoped
      )
    })
  )

export const CrashReportWorkflowLayerFetch = (options: {
  readonly endpointUrl: string
  readonly rateLimitPerHour: number
}): Layer.Layer<
  never,
  CrashReportDrainConfigError,
  | PersistedQueue.PersistedQueueFactory
  | WorkflowEngine.WorkflowEngine
  | EventLog.EventLog
  | EventLog.Registry
> => makeCrashReportDrainLayer(options).pipe(Layer.provide(FetchHttpClient.layer))

export type { EventJournal }
