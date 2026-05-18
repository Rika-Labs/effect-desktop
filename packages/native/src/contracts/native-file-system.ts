import { ResourceHandleSchema, type ResourceHandle } from "@effect-desktop/core"
import { Schema } from "effect"

import { CanonicalPath } from "./path.js"
import { BridgeSafeNonEmptyString, BridgeSafeString } from "./strings.js"

const NonNegativeFiniteNumber = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)

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
  path: CanonicalPath,
  mode: Schema.optionalKey(NativeFileSystemOpenMode),
  handleId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export type NativeFileSystemOpenOptions = Schema.Schema.Type<typeof NativeFileSystemOpenInput>

export class NativeFileSystemStatInput extends Schema.Class<NativeFileSystemStatInput>(
  "NativeFileSystemStatInput"
)({
  path: CanonicalPath
}) {}

export type NativeFileSystemStatOptions = Schema.Schema.Type<typeof NativeFileSystemStatInput>

export class NativeFileSystemWatchInput extends Schema.Class<NativeFileSystemWatchInput>(
  "NativeFileSystemWatchInput"
)({
  path: CanonicalPath,
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
  path: CanonicalPath,
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
  path: CanonicalPath,
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

export class NativeFileSystemEvent extends Schema.Class<NativeFileSystemEvent>(
  "NativeFileSystemEvent"
)({
  type: NativeFileSystemEventType,
  timestamp: NonNegativeFiniteNumber,
  watchId: Schema.optionalKey(BridgeSafeNonEmptyString),
  path: Schema.optionalKey(CanonicalPath),
  phase: NativeFileSystemEventPhase,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}
