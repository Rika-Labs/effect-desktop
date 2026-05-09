import { Effect, Layer, Schedule, Schema } from "effect"
import { EventGroup, EventJournal, EventLog } from "effect/unstable/eventlog"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { PersistedQueue } from "effect/unstable/persistence"
import { Activity, Workflow, WorkflowEngine } from "effect/unstable/workflow"

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

const submissionRetrySchedule = Schedule.exponential("1 second").pipe(
  Schedule.jittered,
  Schedule.both(Schedule.recurs(10))
)

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
    execute: HttpClient.HttpClient.pipe(
      Effect.flatMap((rawClient) => {
        const client = HttpClient.filterStatusOk(rawClient)
        return HttpClientRequest.post(endpointUrl).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            id: report.id,
            capturedAt: report.capturedAt,
            breadcrumbs: report.breadcrumbs,
            ...(report.appVersion === undefined ? {} : { appVersion: report.appVersion }),
            ...(report.platform === undefined ? {} : { platform: report.platform })
          }),
          client.execute,
          Effect.as(undefined as void)
        )
      }),
      Effect.retry({ schedule: submissionRetrySchedule }),
      Effect.catchTag("ResponseError", (e) =>
        Effect.fail(new CrashReportSubmitError({ status: e.response.status, message: e.message }))
      )
    )
  })

export const makeCrashSubmissionWorkflowLayer = (
  endpointUrl: string
): Layer.Layer<
  never,
  never,
  WorkflowEngine.WorkflowEngine | EventLog.EventLog | EventLog.Registry | HttpClient.HttpClient
> =>
  CrashSubmissionWorkflow.toLayer((report) =>
    Effect.gen(function* () {
      const log = yield* EventLog.EventLog
      const activity = makeCrashSubmitActivity(report, endpointUrl)
      yield* activity.pipe(
        Effect.matchEffect({
          onSuccess: () =>
            log
              .write({
                schema: CrashReportEventSchema,
                event: "crash-report-submitted",
                payload: report
              })
              .pipe(Effect.orDie),
          onFailure: (_e) =>
            log
              .write({
                schema: CrashReportEventSchema,
                event: "crash-report-dropped",
                payload: report
              })
              .pipe(Effect.orDie)
        })
      )
    })
  )

export const makeCrashReportQueue: Effect.Effect<
  PersistedQueue.PersistedQueue<CrashReport, never>,
  never,
  PersistedQueue.PersistedQueueFactory
> = PersistedQueue.make({ name: "crash-reports", schema: CrashReport })

const rateGuard = (perHour: number): Effect.Effect<void, never, never> => {
  const intervalMs = Math.ceil((60 * 60 * 1000) / perHour)
  return Effect.sleep(intervalMs)
}

export const makeCrashReportDrainLayer = (options: {
  readonly endpointUrl: string
  readonly rateLimitPerHour: number
}): Layer.Layer<
  never,
  never,
  | PersistedQueue.PersistedQueueFactory
  | WorkflowEngine.WorkflowEngine
  | EventLog.EventLog
  | EventLog.Registry
  | HttpClient.HttpClient
> =>
  Layer.scopedDiscard(
    Effect.gen(function* () {
      const queue = yield* makeCrashReportQueue

      yield* Effect.forever(
        queue.take((report, _meta) =>
          Effect.gen(function* () {
            yield* rateGuard(options.rateLimitPerHour)
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
  never,
  | PersistedQueue.PersistedQueueFactory
  | WorkflowEngine.WorkflowEngine
  | EventLog.EventLog
  | EventLog.Registry
> => makeCrashReportDrainLayer(options).pipe(Layer.provide(FetchHttpClient.layer))

export type { EventJournal }
