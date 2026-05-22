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
const DownloadEventFailureMessage = Schema.makeFilter<{
  readonly phase: DownloadEventPhase
  readonly message?: string | undefined
}>((value) =>
  value.phase === "failed"
    ? value.message !== undefined || "failed download event requires message"
    : value.message === undefined || "non-failed download event must not include message"
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

export class DownloadEvent extends Schema.Class<DownloadEvent>("DownloadEvent")(
  Schema.Struct({
    type: Schema.Literal("download-event"),
    timestamp: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
    phase: DownloadEventPhase,
    download: DownloadResource,
    profile: SessionProfileResource,
    url: DownloadUrl,
    destination: Schema.optionalKey(DownloadDestination),
    receivedBytes: DownloadNonNegativeInt,
    totalBytes: Schema.optionalKey(DownloadNonNegativeInt),
    message: Schema.optionalKey(BridgeSafeString)
  }).check(DownloadByteProgress, DownloadEventFailureMessage)
) {}

const isAbsoluteHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}
