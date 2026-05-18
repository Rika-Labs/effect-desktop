import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const SelectionContextActorKind = Schema.Literals([
  "workspace",
  "extension",
  "tool",
  "process",
  "native",
  "app",
  "window"
])
export type SelectionContextActorKind = typeof SelectionContextActorKind.Type

export const SelectionContextAccess = Schema.Literals(["metadata", "content"])
export type SelectionContextAccess = typeof SelectionContextAccess.Type

export const SelectionContextDocumentKind = Schema.Literals([
  "file",
  "browser-page",
  "editor-buffer",
  "unknown"
])
export type SelectionContextDocumentKind = typeof SelectionContextDocumentKind.Type

export const SelectionContextEventPhase = Schema.Literals([
  "focus-changed",
  "selection-changed",
  "watch-started",
  "watch-stopped",
  "failed"
])
export type SelectionContextEventPhase = typeof SelectionContextEventPhase.Type

export const SelectionContextEventType = Schema.Literal("selection-context-event")
export type SelectionContextEventType = typeof SelectionContextEventType.Type

export const SelectionContextFailureReason = Schema.Literals([
  "denied",
  "unsupported",
  "invalid-input",
  "host-failed"
])
export type SelectionContextFailureReason = typeof SelectionContextFailureReason.Type

const SelectionContextCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const SelectionContextTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)

export class SelectionContextActor extends Schema.Class<SelectionContextActor>(
  "SelectionContextActor"
)({
  kind: SelectionContextActorKind,
  id: PrintableNonEmptyString
}) {}

export class SelectionContextSelectionMetadata extends Schema.Class<SelectionContextSelectionMetadata>(
  "SelectionContextSelectionMetadata"
)({
  sourceApplication: Schema.optionalKey(PrintableNonEmptyString),
  mimeType: Schema.optionalKey(BridgeSafeNonEmptyString),
  characterCount: SelectionContextCount,
  selectionHash: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class SelectionContextDocumentMetadata extends Schema.Class<SelectionContextDocumentMetadata>(
  "SelectionContextDocumentMetadata"
)({
  documentId: BridgeSafeNonEmptyString,
  kind: SelectionContextDocumentKind,
  title: Schema.optionalKey(PrintableNonEmptyString),
  applicationId: Schema.optionalKey(BridgeSafeNonEmptyString),
  filePath: Schema.optionalKey(PrintableNonEmptyString),
  url: Schema.optionalKey(BridgeSafeString),
  bufferId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class SelectionContextReadSelectionRequest extends Schema.Class<SelectionContextReadSelectionRequest>(
  "SelectionContextReadSelectionRequest"
)({
  actor: SelectionContextActor,
  access: SelectionContextAccess,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class SelectionContextReadSelectionInput extends Schema.Class<SelectionContextReadSelectionInput>(
  "SelectionContextReadSelectionInput"
)({
  actor: SelectionContextActor,
  access: SelectionContextAccess,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class SelectionContextReadSelectionResult extends Schema.Class<SelectionContextReadSelectionResult>(
  "SelectionContextReadSelectionResult"
)({
  metadata: SelectionContextSelectionMetadata,
  text: Schema.optionalKey(PrintableNonEmptyString)
}) {}

export class SelectionContextReadDocumentRequest extends Schema.Class<SelectionContextReadDocumentRequest>(
  "SelectionContextReadDocumentRequest"
)({
  actor: SelectionContextActor,
  access: SelectionContextAccess,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class SelectionContextReadDocumentInput extends Schema.Class<SelectionContextReadDocumentInput>(
  "SelectionContextReadDocumentInput"
)({
  actor: SelectionContextActor,
  access: SelectionContextAccess,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class SelectionContextReadDocumentResult extends Schema.Class<SelectionContextReadDocumentResult>(
  "SelectionContextReadDocumentResult"
)({
  metadata: SelectionContextDocumentMetadata,
  text: Schema.optionalKey(PrintableNonEmptyString)
}) {}

export class SelectionContextWatchFocusRequest extends Schema.Class<SelectionContextWatchFocusRequest>(
  "SelectionContextWatchFocusRequest"
)({
  actor: SelectionContextActor,
  watchId: Schema.optionalKey(BridgeSafeNonEmptyString),
  ownerScope: Schema.optionalKey(BridgeSafeNonEmptyString),
  access: SelectionContextAccess,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class SelectionContextWatchFocusInput extends Schema.Class<SelectionContextWatchFocusInput>(
  "SelectionContextWatchFocusInput"
)({
  actor: SelectionContextActor,
  watchId: Schema.optionalKey(BridgeSafeNonEmptyString),
  ownerScope: Schema.optionalKey(BridgeSafeNonEmptyString),
  access: SelectionContextAccess,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class SelectionContextWatchFocusResult extends Schema.Class<SelectionContextWatchFocusResult>(
  "SelectionContextWatchFocusResult"
)({
  watchId: BridgeSafeNonEmptyString,
  active: Schema.Boolean,
  access: SelectionContextAccess
}) {}

export class SelectionContextStopWatchingRequest extends Schema.Class<SelectionContextStopWatchingRequest>(
  "SelectionContextStopWatchingRequest"
)({
  actor: SelectionContextActor,
  watchId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class SelectionContextStopWatchingInput extends Schema.Class<SelectionContextStopWatchingInput>(
  "SelectionContextStopWatchingInput"
)({
  actor: SelectionContextActor,
  watchId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class SelectionContextStopWatchingResult extends Schema.Class<SelectionContextStopWatchingResult>(
  "SelectionContextStopWatchingResult"
)({
  watchId: BridgeSafeNonEmptyString,
  stopped: Schema.Boolean
}) {}

export class SelectionContextSupportedResult extends Schema.Class<SelectionContextSupportedResult>(
  "SelectionContextSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class SelectionContextEvent extends Schema.Class<SelectionContextEvent>(
  "SelectionContextEvent"
)({
  type: SelectionContextEventType,
  timestamp: SelectionContextTimestamp,
  phase: SelectionContextEventPhase,
  watchId: Schema.optionalKey(BridgeSafeNonEmptyString),
  document: Schema.optionalKey(SelectionContextDocumentMetadata),
  selection: Schema.optionalKey(SelectionContextSelectionMetadata),
  reason: Schema.optionalKey(SelectionContextFailureReason),
  message: Schema.optionalKey(BridgeSafeString)
}) {}
