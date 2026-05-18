import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const FocusedApplicationContextActorKind = Schema.Literals([
  "workspace",
  "extension",
  "tool",
  "process",
  "native",
  "app",
  "window"
])
export type FocusedApplicationContextActorKind = typeof FocusedApplicationContextActorKind.Type

export const FocusedApplicationContextEventPhase = Schema.Literals([
  "focus-changed",
  "watch-started",
  "watch-stopped",
  "failed"
])
export type FocusedApplicationContextEventPhase = typeof FocusedApplicationContextEventPhase.Type

export const FocusedApplicationContextEventType = Schema.Literal(
  "focused-application-context-event"
)
export type FocusedApplicationContextEventType = typeof FocusedApplicationContextEventType.Type

export const FocusedApplicationContextFailureReason = Schema.Literals([
  "denied",
  "unsupported",
  "invalid-input",
  "host-failed"
])
export type FocusedApplicationContextFailureReason =
  typeof FocusedApplicationContextFailureReason.Type

const FocusedApplicationContextTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)
const FocusedApplicationContextCoordinate = Schema.Number.check(Schema.isFinite())
const FocusedApplicationContextSize = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)

export class FocusedApplicationContextActor extends Schema.Class<FocusedApplicationContextActor>(
  "FocusedApplicationContextActor"
)({
  kind: FocusedApplicationContextActorKind,
  id: PrintableNonEmptyString
}) {}

export class FocusedApplicationContextBounds extends Schema.Class<FocusedApplicationContextBounds>(
  "FocusedApplicationContextBounds"
)({
  x: FocusedApplicationContextCoordinate,
  y: FocusedApplicationContextCoordinate,
  width: FocusedApplicationContextSize,
  height: FocusedApplicationContextSize
}) {}

export class FocusedApplicationMetadata extends Schema.Class<FocusedApplicationMetadata>(
  "FocusedApplicationMetadata"
)({
  applicationId: BridgeSafeNonEmptyString,
  name: Schema.optionalKey(PrintableNonEmptyString),
  bundleId: Schema.optionalKey(BridgeSafeNonEmptyString),
  packageName: Schema.optionalKey(BridgeSafeNonEmptyString),
  executablePath: Schema.optionalKey(PrintableNonEmptyString),
  processId: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
}) {}

export class FocusedWindowMetadata extends Schema.Class<FocusedWindowMetadata>(
  "FocusedWindowMetadata"
)({
  windowId: Schema.optionalKey(BridgeSafeNonEmptyString),
  title: Schema.optionalKey(PrintableNonEmptyString),
  bounds: Schema.optionalKey(FocusedApplicationContextBounds),
  displayId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class FocusedDisplayMetadata extends Schema.Class<FocusedDisplayMetadata>(
  "FocusedDisplayMetadata"
)({
  displayId: BridgeSafeNonEmptyString,
  bounds: Schema.optionalKey(FocusedApplicationContextBounds),
  scaleFactor: Schema.optionalKey(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)))
}) {}

export class FocusedApplicationContextSnapshotRequest extends Schema.Class<FocusedApplicationContextSnapshotRequest>(
  "FocusedApplicationContextSnapshotRequest"
)({
  actor: FocusedApplicationContextActor,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class FocusedApplicationContextSnapshotInput extends Schema.Class<FocusedApplicationContextSnapshotInput>(
  "FocusedApplicationContextSnapshotInput"
)({
  actor: FocusedApplicationContextActor,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class FocusedApplicationContextSnapshotResult extends Schema.Class<FocusedApplicationContextSnapshotResult>(
  "FocusedApplicationContextSnapshotResult"
)({
  application: FocusedApplicationMetadata,
  window: Schema.optionalKey(FocusedWindowMetadata),
  display: Schema.optionalKey(FocusedDisplayMetadata),
  observedAt: FocusedApplicationContextTimestamp
}) {}

export class FocusedApplicationContextWatchRequest extends Schema.Class<FocusedApplicationContextWatchRequest>(
  "FocusedApplicationContextWatchRequest"
)({
  actor: FocusedApplicationContextActor,
  watchId: Schema.optionalKey(BridgeSafeNonEmptyString),
  ownerScope: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class FocusedApplicationContextWatchInput extends Schema.Class<FocusedApplicationContextWatchInput>(
  "FocusedApplicationContextWatchInput"
)({
  actor: FocusedApplicationContextActor,
  watchId: Schema.optionalKey(BridgeSafeNonEmptyString),
  ownerScope: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class FocusedApplicationContextWatchResult extends Schema.Class<FocusedApplicationContextWatchResult>(
  "FocusedApplicationContextWatchResult"
)({
  watchId: BridgeSafeNonEmptyString,
  active: Schema.Boolean
}) {}

export class FocusedApplicationContextStopWatchingRequest extends Schema.Class<FocusedApplicationContextStopWatchingRequest>(
  "FocusedApplicationContextStopWatchingRequest"
)({
  actor: FocusedApplicationContextActor,
  watchId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class FocusedApplicationContextStopWatchingInput extends Schema.Class<FocusedApplicationContextStopWatchingInput>(
  "FocusedApplicationContextStopWatchingInput"
)({
  actor: FocusedApplicationContextActor,
  watchId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class FocusedApplicationContextStopWatchingResult extends Schema.Class<FocusedApplicationContextStopWatchingResult>(
  "FocusedApplicationContextStopWatchingResult"
)({
  watchId: BridgeSafeNonEmptyString,
  stopped: Schema.Boolean
}) {}

export class FocusedApplicationContextSupportedResult extends Schema.Class<FocusedApplicationContextSupportedResult>(
  "FocusedApplicationContextSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class FocusedApplicationContextEvent extends Schema.Class<FocusedApplicationContextEvent>(
  "FocusedApplicationContextEvent"
)({
  type: FocusedApplicationContextEventType,
  timestamp: FocusedApplicationContextTimestamp,
  phase: FocusedApplicationContextEventPhase,
  watchId: Schema.optionalKey(BridgeSafeNonEmptyString),
  snapshot: Schema.optionalKey(FocusedApplicationContextSnapshotResult),
  reason: Schema.optionalKey(FocusedApplicationContextFailureReason),
  message: Schema.optionalKey(BridgeSafeString)
}) {}
