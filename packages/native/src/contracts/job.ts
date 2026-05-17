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

export class JobProgressRequest extends Schema.Class<JobProgressRequest>("JobProgressRequest")({
  jobId: BridgeSafeNonEmptyString,
  completed: JobProgressCompleted,
  total: Schema.optionalKey(JobProgressTotal),
  message: Schema.optionalKey(BridgeSafeString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class JobGetRequest extends Schema.Class<JobGetRequest>("JobGetRequest")({
  jobId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class JobProgress extends Schema.Class<JobProgress>("JobProgress")({
  completed: JobProgressCompleted,
  total: Schema.optionalKey(JobProgressTotal),
  message: Schema.optionalKey(BridgeSafeString),
  updatedAt: JobTimestamp
}) {}

export class JobSnapshot extends Schema.Class<JobSnapshot>("JobSnapshot")({
  handle: JobHandle,
  name: PrintableNonEmptyString,
  state: JobState,
  startedAt: JobTimestamp,
  updatedAt: JobTimestamp,
  progress: Schema.optionalKey(JobProgress),
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class JobSupportedResult extends Schema.Class<JobSupportedResult>("JobSupportedResult")({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class JobEvent extends Schema.Class<JobEvent>("JobEvent")({
  type: JobEventType,
  timestamp: JobTimestamp,
  phase: JobEventPhase,
  job: JobSnapshot
}) {}
