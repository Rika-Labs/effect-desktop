import { ResourceHandleSchema, type ResourceHandle } from "@orika/core"
import { Schema } from "effect"

import { SessionProfileResource } from "./session-profile.js"
import { BridgeSafeNonEmptyString, BridgeSafeString } from "./strings.js"

export const DownloadResource = ResourceHandleSchema("download", "open")
export type DownloadHandle = ResourceHandle<"download", "open">

const DownloadUrl = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^(?!javascript:|data:|vbscript:|blob:|file:)[\s\S]*$/iu),
  Schema.makeFilter((value) => isAbsoluteHttpUrl(value) || "must be an absolute HTTP(S) URL")
)
const DownloadDestination = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[\s\S]*$/u)
)
const DownloadNonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const DownloadByteProgress = Schema.makeFilter<{
  readonly receivedBytes: number
  readonly totalBytes?: number | undefined
}>(
  (value) =>
    value.totalBytes === undefined ||
    value.receivedBytes <= value.totalBytes ||
    "receivedBytes must not exceed totalBytes"
)
const DownloadSnapshotFailureMessage = Schema.makeFilter<{
  readonly state: DownloadState
  readonly message?: string | undefined
}>((value) =>
  value.state === "failed"
    ? value.message !== undefined || "failed download snapshot requires message"
    : value.message === undefined || "non-failed download snapshot must not include message"
)

export const DownloadState = Schema.Literals([
  "running",
  "paused",
  "completed",
  "canceled",
  "failed"
])
export type DownloadState = typeof DownloadState.Type

const DownloadEventPhase = Schema.Literals([
  "started",
  "progressed",
  "paused",
  "resumed",
  "completed",
  "canceled",
  "failed"
])
export type DownloadEventPhase = typeof DownloadEventPhase.Type

export class DownloadStartInput extends Schema.Class<DownloadStartInput>("DownloadStartInput")({
  profile: SessionProfileResource,
  url: DownloadUrl,
  destination: Schema.optionalKey(DownloadDestination),
  ownerScope: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class DownloadHandleInput extends Schema.Class<DownloadHandleInput>("DownloadHandleInput")({
  download: DownloadResource,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class DownloadListInput extends Schema.Class<DownloadListInput>("DownloadListInput")({
  profile: Schema.optionalKey(SessionProfileResource),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class DownloadSnapshot extends Schema.Class<DownloadSnapshot>("DownloadSnapshot")(
  Schema.Struct({
    download: DownloadResource,
    profile: SessionProfileResource,
    url: DownloadUrl,
    destination: Schema.optionalKey(DownloadDestination),
    state: DownloadState,
    receivedBytes: DownloadNonNegativeInt,
    totalBytes: Schema.optionalKey(DownloadNonNegativeInt),
    message: Schema.optionalKey(BridgeSafeString)
  }).check(DownloadByteProgress, DownloadSnapshotFailureMessage)
) {}

export class DownloadListResult extends Schema.Class<DownloadListResult>("DownloadListResult")({
  downloads: Schema.Array(DownloadSnapshot)
}) {}

export class DownloadSupportedResult extends Schema.Class<DownloadSupportedResult>(
  "DownloadSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

const DownloadEventBase = {
  type: Schema.Literal("download-event"),
  timestamp: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  download: DownloadResource,
  profile: SessionProfileResource,
  url: DownloadUrl,
  destination: Schema.optionalKey(DownloadDestination),
  receivedBytes: DownloadNonNegativeInt,
  totalBytes: Schema.optionalKey(DownloadNonNegativeInt)
}

export class DownloadStartedEvent extends Schema.Class<DownloadStartedEvent>(
  "DownloadStartedEvent"
)(
  Schema.Struct({
    ...DownloadEventBase,
    phase: Schema.Literal("started"),
    message: Schema.optionalKey(Schema.Never)
  }).check(DownloadByteProgress)
) {}

export class DownloadProgressedEvent extends Schema.Class<DownloadProgressedEvent>(
  "DownloadProgressedEvent"
)(
  Schema.Struct({
    ...DownloadEventBase,
    phase: Schema.Literal("progressed"),
    message: Schema.optionalKey(Schema.Never)
  }).check(DownloadByteProgress)
) {}

export class DownloadPausedEvent extends Schema.Class<DownloadPausedEvent>("DownloadPausedEvent")(
  Schema.Struct({
    ...DownloadEventBase,
    phase: Schema.Literal("paused"),
    message: Schema.optionalKey(Schema.Never)
  }).check(DownloadByteProgress)
) {}

export class DownloadResumedEvent extends Schema.Class<DownloadResumedEvent>(
  "DownloadResumedEvent"
)(
  Schema.Struct({
    ...DownloadEventBase,
    phase: Schema.Literal("resumed"),
    message: Schema.optionalKey(Schema.Never)
  }).check(DownloadByteProgress)
) {}

export class DownloadCompletedEvent extends Schema.Class<DownloadCompletedEvent>(
  "DownloadCompletedEvent"
)(
  Schema.Struct({
    ...DownloadEventBase,
    phase: Schema.Literal("completed"),
    message: Schema.optionalKey(Schema.Never)
  }).check(DownloadByteProgress)
) {}

export class DownloadCanceledEvent extends Schema.Class<DownloadCanceledEvent>(
  "DownloadCanceledEvent"
)(
  Schema.Struct({
    ...DownloadEventBase,
    phase: Schema.Literal("canceled"),
    message: Schema.optionalKey(Schema.Never)
  }).check(DownloadByteProgress)
) {}

export class DownloadFailedEvent extends Schema.Class<DownloadFailedEvent>("DownloadFailedEvent")(
  Schema.Struct({
    ...DownloadEventBase,
    phase: Schema.Literal("failed"),
    message: BridgeSafeString
  }).check(DownloadByteProgress)
) {}

export const DownloadEvent = Schema.Union([
  DownloadStartedEvent,
  DownloadProgressedEvent,
  DownloadPausedEvent,
  DownloadResumedEvent,
  DownloadCompletedEvent,
  DownloadCanceledEvent,
  DownloadFailedEvent
])
export type DownloadEvent = typeof DownloadEvent.Type

const isAbsoluteHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}
