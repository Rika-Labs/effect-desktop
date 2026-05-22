import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const JobState = Schema.Literals(["running", "paused", "interrupted", "succeeded", "failed"])
export type JobState = typeof JobState.Type

export const JobEventPhase = Schema.Literals([
  "started",
  "paused",
  "resumed",
  "retried",
  "interrupted",
  "progress",
  "succeeded",
  "failed"
])
export type JobEventPhase = typeof JobEventPhase.Type

export const JobEventType = Schema.Literal("job-event")
export type JobEventType = typeof JobEventType.Type

const JobTimestamp = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
const JobProgressCompleted = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)
const JobProgressTotal = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))
const JobProgressRange = Schema.makeFilter<{
  readonly completed: number
  readonly total?: number | undefined
}>(
  (value) =>
    value.total === undefined || value.completed <= value.total || "completed must not exceed total"
)

export class JobHandle extends Schema.Class<JobHandle>("JobHandle")({
  kind: Schema.Literal("job"),
  id: BridgeSafeNonEmptyString,
  generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ownerScope: BridgeSafeNonEmptyString,
  state: JobState
}) {}

export class JobStartRequest extends Schema.Class<JobStartRequest>("JobStartRequest")({
  jobId: Schema.optionalKey(BridgeSafeNonEmptyString),
  name: PrintableNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class JobControlRequest extends Schema.Class<JobControlRequest>("JobControlRequest")({
  jobId: BridgeSafeNonEmptyString,
  reason: Schema.optionalKey(BridgeSafeString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class JobProgressRequest extends Schema.Class<JobProgressRequest>("JobProgressRequest")(
  Schema.Struct({
    jobId: BridgeSafeNonEmptyString,
    completed: JobProgressCompleted,
    total: Schema.optionalKey(JobProgressTotal),
    message: Schema.optionalKey(BridgeSafeString),
    traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
  }).check(JobProgressRange)
) {}

export class JobGetRequest extends Schema.Class<JobGetRequest>("JobGetRequest")({
  jobId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class JobProgress extends Schema.Class<JobProgress>("JobProgress")(
  Schema.Struct({
    completed: JobProgressCompleted,
    total: Schema.optionalKey(JobProgressTotal),
    message: Schema.optionalKey(BridgeSafeString),
    updatedAt: JobTimestamp
  }).check(JobProgressRange)
) {}

export class JobSnapshot extends Schema.Class<JobSnapshot>("JobSnapshot")({
  handle: JobHandle,
  name: PrintableNonEmptyString,
  state: JobState,
  startedAt: JobTimestamp,
  updatedAt: JobTimestamp,
  progress: Schema.optionalKey(JobProgress),
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

const isMutableJobState = (state: JobState): boolean => state === "running" || state === "paused"

const JobEventPhaseState = Schema.makeFilter<{
  readonly phase: JobEventPhase
  readonly job: {
    readonly state: JobState
  }
}>((value) => {
  switch (value.phase) {
    case "started":
    case "resumed":
    case "retried":
      return value.job.state === "running" || `${value.phase} events require running job state`
    case "paused":
      return value.job.state === "paused" || "paused events require paused job state"
    case "interrupted":
      return value.job.state === "interrupted" || "interrupted events require interrupted job state"
    case "progress":
      return isMutableJobState(value.job.state) || "progress events require mutable job state"
    case "succeeded":
      return value.job.state === "succeeded" || "succeeded events require succeeded job state"
    case "failed":
      return value.job.state === "failed" || "failed events require failed job state"
  }
})

export class JobSupportedResult extends Schema.Class<JobSupportedResult>("JobSupportedResult")({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class JobEvent extends Schema.Class<JobEvent>("JobEvent")(
  Schema.Struct({
    type: JobEventType,
    timestamp: JobTimestamp,
    phase: JobEventPhase,
    job: JobSnapshot
  }).check(JobEventPhaseState)
) {}
