import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const AttachmentIntakeActorKind = Schema.Literals([
  "workspace",
  "extension",
  "tool",
  "process",
  "native",
  "app",
  "window"
])
export type AttachmentIntakeActorKind = typeof AttachmentIntakeActorKind.Type

export const AttachmentIntakeSource = Schema.Literals([
  "provided-by-caller",
  "drag-drop",
  "paste",
  "file-picker",
  "clipboard-file",
  "screenshot",
  "mime-payload"
])
export type AttachmentIntakeSource = typeof AttachmentIntakeSource.Type

export const AttachmentIntakeState = Schema.Literals(["ingested", "disposed"])
export type AttachmentIntakeState = typeof AttachmentIntakeState.Type

export const AttachmentIntakeEventPhase = Schema.Literals(["ingested", "disposed", "failed"])
export type AttachmentIntakeEventPhase = typeof AttachmentIntakeEventPhase.Type

export const AttachmentIntakeEventType = Schema.Literal("attachment-intake-event")
export type AttachmentIntakeEventType = typeof AttachmentIntakeEventType.Type

export const AttachmentIntakeFailureReason = Schema.Literals([
  "denied",
  "unsupported",
  "invalid-input",
  "host-failed"
])
export type AttachmentIntakeFailureReason = typeof AttachmentIntakeFailureReason.Type

const AttachmentIntakeNonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const AttachmentIntakePositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const AttachmentIntakeTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)

export class AttachmentIntakeActor extends Schema.Class<AttachmentIntakeActor>(
  "AttachmentIntakeActor"
)({
  kind: AttachmentIntakeActorKind,
  id: PrintableNonEmptyString
}) {}

export class AttachmentIntakePolicy extends Schema.Class<AttachmentIntakePolicy>(
  "AttachmentIntakePolicy"
)({
  allowedMimeTypes: Schema.Array(BridgeSafeNonEmptyString),
  maxItems: AttachmentIntakePositiveInt,
  maxBytesPerItem: AttachmentIntakePositiveInt,
  maxTotalBytes: AttachmentIntakePositiveInt,
  lifetimeMillis: AttachmentIntakePositiveInt
}) {}

export class AttachmentIntakeItemInput extends Schema.Class<AttachmentIntakeItemInput>(
  "AttachmentIntakeItemInput"
)({
  itemId: Schema.optionalKey(BridgeSafeNonEmptyString),
  name: Schema.optionalKey(PrintableNonEmptyString),
  mimeType: BridgeSafeNonEmptyString,
  source: AttachmentIntakeSource,
  bytes: Schema.Uint8Array
}) {}

export class AttachmentIntakeItem extends Schema.Class<AttachmentIntakeItem>(
  "AttachmentIntakeItem"
)({
  itemId: BridgeSafeNonEmptyString,
  name: Schema.optionalKey(PrintableNonEmptyString),
  mimeType: BridgeSafeNonEmptyString,
  source: AttachmentIntakeSource,
  sizeBytes: AttachmentIntakeNonNegativeInt
}) {}

export class AttachmentIntakeIngestRequest extends Schema.Class<AttachmentIntakeIngestRequest>(
  "AttachmentIntakeIngestRequest"
)({
  actor: AttachmentIntakeActor,
  policy: AttachmentIntakePolicy,
  items: Schema.Array(AttachmentIntakeItemInput),
  intakeId: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class AttachmentIntakeIngestInput extends Schema.Class<AttachmentIntakeIngestInput>(
  "AttachmentIntakeIngestInput"
)({
  actor: AttachmentIntakeActor,
  policy: AttachmentIntakePolicy,
  items: Schema.Array(AttachmentIntakeItemInput),
  intakeId: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class AttachmentIntakeInspectRequest extends Schema.Class<AttachmentIntakeInspectRequest>(
  "AttachmentIntakeInspectRequest"
)({
  intakeId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class AttachmentIntakeInspectInput extends Schema.Class<AttachmentIntakeInspectInput>(
  "AttachmentIntakeInspectInput"
)({
  intakeId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class AttachmentIntakeDisposeRequest extends Schema.Class<AttachmentIntakeDisposeRequest>(
  "AttachmentIntakeDisposeRequest"
)({
  intakeId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class AttachmentIntakeDisposeInput extends Schema.Class<AttachmentIntakeDisposeInput>(
  "AttachmentIntakeDisposeInput"
)({
  intakeId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class AttachmentIntakeIngestResult extends Schema.Class<AttachmentIntakeIngestResult>(
  "AttachmentIntakeIngestResult"
)({
  intakeId: BridgeSafeNonEmptyString,
  items: Schema.Array(AttachmentIntakeItem),
  state: Schema.Literal("ingested"),
  expiresAt: AttachmentIntakeTimestamp
}) {}

export class AttachmentIntakeInspectResult extends Schema.Class<AttachmentIntakeInspectResult>(
  "AttachmentIntakeInspectResult"
)({
  intakeId: BridgeSafeNonEmptyString,
  items: Schema.Array(AttachmentIntakeItem),
  state: AttachmentIntakeState,
  expiresAt: AttachmentIntakeTimestamp
}) {}

export class AttachmentIntakeDisposeResult extends Schema.Class<AttachmentIntakeDisposeResult>(
  "AttachmentIntakeDisposeResult"
)({
  intakeId: BridgeSafeNonEmptyString,
  disposed: Schema.Boolean
}) {}

export class AttachmentIntakeSupportedResult extends Schema.Class<AttachmentIntakeSupportedResult>(
  "AttachmentIntakeSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

const AttachmentIntakeEventPhasePayload = Schema.makeFilter<{
  readonly phase: AttachmentIntakeEventPhase
  readonly state?: AttachmentIntakeState | undefined
  readonly itemCount?: number | undefined
  readonly reason?: AttachmentIntakeFailureReason | undefined
  readonly message?: string | undefined
}>((value) => {
  switch (value.phase) {
    case "ingested":
      return (
        (value.state === "ingested" &&
          value.itemCount !== undefined &&
          value.reason === undefined &&
          value.message === undefined) ||
        "ingested attachment intake events require ingested state and itemCount only"
      )
    case "disposed":
      return (
        (value.state === "disposed" &&
          value.itemCount === undefined &&
          value.reason === undefined &&
          value.message === undefined) ||
        "disposed attachment intake events require disposed state only"
      )
    case "failed":
      return (
        (value.state === undefined &&
          value.itemCount === undefined &&
          value.reason !== undefined) ||
        "failed attachment intake events require reason and no state or itemCount"
      )
  }
})

export class AttachmentIntakeEvent extends Schema.Class<AttachmentIntakeEvent>(
  "AttachmentIntakeEvent"
)(
  Schema.Struct({
    type: AttachmentIntakeEventType,
    timestamp: AttachmentIntakeTimestamp,
    intakeId: Schema.optionalKey(BridgeSafeNonEmptyString),
    phase: AttachmentIntakeEventPhase,
    state: Schema.optionalKey(AttachmentIntakeState),
    itemCount: Schema.optionalKey(AttachmentIntakeNonNegativeInt),
    reason: Schema.optionalKey(AttachmentIntakeFailureReason),
    message: Schema.optionalKey(BridgeSafeString)
  }).check(AttachmentIntakeEventPhasePayload)
) {}
