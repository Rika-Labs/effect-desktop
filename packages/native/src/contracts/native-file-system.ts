import { ResourceHandleSchema, type ResourceHandle } from "@orika/core"
import { Schema } from "effect"

import { CanonicalPath } from "./path.js"
import { BridgeSafeNonEmptyString, BridgeSafeString } from "./strings.js"

const NonNegativeFiniteNumber = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)
const NativeFileSystemPath = CanonicalPath.check(
  Schema.makeFilter(
    (value) =>
      isSafeNativeFileSystemPath(value.path) ||
      "must be an absolute path without control characters or dot segments"
  )
)

const WindowsDriveAbsolutePathPattern = /^[A-Za-z]:[\\/]/u
const WindowsUncAbsolutePathPattern = /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u
const ControlCharacterPattern = /\p{Cc}/u

const isSafeNativeFileSystemPath = (value: string): boolean => {
  if (ControlCharacterPattern.test(value)) {
    return false
  }

  if (value.startsWith("/")) {
    return !hasDotPathSegment(value, /\/+/u)
  }

  if (WindowsDriveAbsolutePathPattern.test(value) || WindowsUncAbsolutePathPattern.test(value)) {
    return !hasDotPathSegment(value, /[\\/]+/u)
  }

  return false
}

const hasDotPathSegment = (value: string, separator: RegExp): boolean =>
  value.split(separator).some((segment) => segment === "." || segment === "..")

export const NativeFileSystemHandleResource = ResourceHandleSchema(
  "native-file-system-handle",
  "open"
)
export type NativeFileSystemHandle = ResourceHandle<"native-file-system-handle", "open">

export const NativeFileSystemWatchResource = ResourceHandleSchema(
  "native-file-system-watch",
  "open"
)
export type NativeFileSystemWatch = ResourceHandle<"native-file-system-watch", "open">

export const NativeFileSystemEntryKind = Schema.Literals(["file", "directory", "symlink", "other"])
export type NativeFileSystemEntryKind = typeof NativeFileSystemEntryKind.Type

export const NativeFileSystemOpenMode = Schema.Literals(["read", "write", "read-write"])
export type NativeFileSystemOpenMode = typeof NativeFileSystemOpenMode.Type

export const NativeFileSystemEventPhase = Schema.Literals([
  "watch-started",
  "changed",
  "removed",
  "failed",
  "watch-stopped"
])
export type NativeFileSystemEventPhase = typeof NativeFileSystemEventPhase.Type

export const NativeFileSystemEventType = Schema.Literal("native-file-system-event")
export type NativeFileSystemEventType = typeof NativeFileSystemEventType.Type

export class NativeFileSystemOpenInput extends Schema.Class<NativeFileSystemOpenInput>(
  "NativeFileSystemOpenInput"
)({
  path: NativeFileSystemPath,
  mode: Schema.optionalKey(NativeFileSystemOpenMode),
  handleId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export type NativeFileSystemOpenOptions = Schema.Schema.Type<typeof NativeFileSystemOpenInput>

export class NativeFileSystemStatInput extends Schema.Class<NativeFileSystemStatInput>(
  "NativeFileSystemStatInput"
)({
  path: NativeFileSystemPath
}) {}

export type NativeFileSystemStatOptions = Schema.Schema.Type<typeof NativeFileSystemStatInput>

export class NativeFileSystemWatchInput extends Schema.Class<NativeFileSystemWatchInput>(
  "NativeFileSystemWatchInput"
)({
  path: NativeFileSystemPath,
  recursive: Schema.optionalKey(Schema.Boolean),
  watchId: Schema.optionalKey(BridgeSafeNonEmptyString),
  ownerScope: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export type NativeFileSystemWatchOptions = Schema.Schema.Type<typeof NativeFileSystemWatchInput>

export class NativeFileSystemStopWatchingInput extends Schema.Class<NativeFileSystemStopWatchingInput>(
  "NativeFileSystemStopWatchingInput"
)({
  watchId: BridgeSafeNonEmptyString
}) {}

export type NativeFileSystemStopWatchingOptions = Schema.Schema.Type<
  typeof NativeFileSystemStopWatchingInput
>

export class NativeFileSystemMetadata extends Schema.Class<NativeFileSystemMetadata>(
  "NativeFileSystemMetadata"
)({
  path: NativeFileSystemPath,
  kind: NativeFileSystemEntryKind,
  sizeBytes: Schema.optionalKey(NonNegativeFiniteNumber),
  modifiedMillis: Schema.optionalKey(NonNegativeFiniteNumber)
}) {}

export class NativeFileSystemOpenResult extends Schema.Class<NativeFileSystemOpenResult>(
  "NativeFileSystemOpenResult"
)({
  handle: NativeFileSystemHandleResource,
  metadata: NativeFileSystemMetadata
}) {}

export class NativeFileSystemWatchResult extends Schema.Class<NativeFileSystemWatchResult>(
  "NativeFileSystemWatchResult"
)({
  watch: NativeFileSystemWatchResource,
  path: NativeFileSystemPath,
  recursive: Schema.Boolean
}) {}

export class NativeFileSystemStopWatchingResult extends Schema.Class<NativeFileSystemStopWatchingResult>(
  "NativeFileSystemStopWatchingResult"
)({
  watchId: BridgeSafeNonEmptyString,
  stopped: Schema.Boolean
}) {}

export class NativeFileSystemSupportedResult extends Schema.Class<NativeFileSystemSupportedResult>(
  "NativeFileSystemSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

const NativeFileSystemEventPhasePayload = Schema.makeFilter<{
  readonly phase: NativeFileSystemEventPhase
  readonly watchId?: string | undefined
  readonly path?: typeof NativeFileSystemPath.Type | undefined
  readonly reason?: string | undefined
}>((value) => {
  switch (value.phase) {
    case "watch-started":
    case "changed":
    case "removed":
      return (
        (value.watchId !== undefined && value.path !== undefined && value.reason === undefined) ||
        `${value.phase} native filesystem events require watchId and path only`
      )
    case "failed":
      return (
        (value.watchId !== undefined && value.path === undefined && value.reason !== undefined) ||
        "failed native filesystem events require watchId and reason only"
      )
    case "watch-stopped":
      return (
        (value.watchId !== undefined && value.path === undefined && value.reason === undefined) ||
        "watch-stopped native filesystem events require watchId only"
      )
  }
})

export class NativeFileSystemEvent extends Schema.Class<NativeFileSystemEvent>(
  "NativeFileSystemEvent"
)(
  Schema.Struct({
    type: NativeFileSystemEventType,
    timestamp: NonNegativeFiniteNumber,
    watchId: Schema.optionalKey(BridgeSafeNonEmptyString),
    path: Schema.optionalKey(NativeFileSystemPath),
    phase: NativeFileSystemEventPhase,
    reason: Schema.optionalKey(BridgeSafeString)
  }).check(NativeFileSystemEventPhasePayload)
) {}
