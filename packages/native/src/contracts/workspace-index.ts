import { NormalizedCapability } from "@orika/core"
import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const WorkspaceIndexActorKind = Schema.Literals([
  "workspace",
  "extension",
  "tool",
  "process",
  "native",
  "app",
  "window"
])
export type WorkspaceIndexActorKind = typeof WorkspaceIndexActorKind.Type

export const WorkspaceIndexState = Schema.Literals(["opened", "refreshing", "closed"])
export type WorkspaceIndexState = typeof WorkspaceIndexState.Type

export const WorkspaceIndexEntryKind = Schema.Literals(["file", "directory", "symlink", "unknown"])
export type WorkspaceIndexEntryKind = typeof WorkspaceIndexEntryKind.Type

export const WorkspaceIndexEventPhase = Schema.Literals([
  "opened",
  "refresh-started",
  "entry-indexed",
  "entry-invalidated",
  "refresh-completed",
  "closed"
])
export type WorkspaceIndexEventPhase = typeof WorkspaceIndexEventPhase.Type

export const WorkspaceIndexEventType = Schema.Literal("workspace-index-event")
export type WorkspaceIndexEventType = typeof WorkspaceIndexEventType.Type

const WorkspaceIndexNonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const WorkspaceIndexTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)

export class WorkspaceIndexActor extends Schema.Class<WorkspaceIndexActor>("WorkspaceIndexActor")({
  kind: WorkspaceIndexActorKind,
  id: PrintableNonEmptyString
}) {}

export class WorkspaceIndexIgnoreRule extends Schema.Class<WorkspaceIndexIgnoreRule>(
  "WorkspaceIndexIgnoreRule"
)({
  pattern: PrintableNonEmptyString,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class WorkspaceIndexScope extends Schema.Class<WorkspaceIndexScope>("WorkspaceIndexScope")({
  root: PrintableNonEmptyString,
  ignoreRules: Schema.Array(WorkspaceIndexIgnoreRule),
  grants: Schema.Array(NormalizedCapability),
  watch: Schema.optionalKey(Schema.Boolean)
}) {}

export class WorkspaceIndexEntry extends Schema.Class<WorkspaceIndexEntry>("WorkspaceIndexEntry")({
  path: PrintableNonEmptyString,
  kind: WorkspaceIndexEntryKind,
  sizeBytes: Schema.optionalKey(WorkspaceIndexNonNegativeInt),
  modifiedAt: Schema.optionalKey(WorkspaceIndexTimestamp)
}) {}

export class WorkspaceIndexOpenRequest extends Schema.Class<WorkspaceIndexOpenRequest>(
  "WorkspaceIndexOpenRequest"
)({
  actor: WorkspaceIndexActor,
  scope: WorkspaceIndexScope,
  indexId: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class WorkspaceIndexOpenInput extends Schema.Class<WorkspaceIndexOpenInput>(
  "WorkspaceIndexOpenInput"
)({
  actor: WorkspaceIndexActor,
  scope: WorkspaceIndexScope,
  indexId: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class WorkspaceIndexOpenResult extends Schema.Class<WorkspaceIndexOpenResult>(
  "WorkspaceIndexOpenResult"
)({
  indexId: BridgeSafeNonEmptyString,
  root: PrintableNonEmptyString,
  state: Schema.Literal("opened")
}) {}

export class WorkspaceIndexRefreshRequest extends Schema.Class<WorkspaceIndexRefreshRequest>(
  "WorkspaceIndexRefreshRequest"
)({
  indexId: BridgeSafeNonEmptyString,
  changedPaths: Schema.optionalKey(Schema.Array(PrintableNonEmptyString)),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class WorkspaceIndexRefreshInput extends Schema.Class<WorkspaceIndexRefreshInput>(
  "WorkspaceIndexRefreshInput"
)({
  indexId: BridgeSafeNonEmptyString,
  changedPaths: Schema.optionalKey(Schema.Array(PrintableNonEmptyString)),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class WorkspaceIndexRefreshResult extends Schema.Class<WorkspaceIndexRefreshResult>(
  "WorkspaceIndexRefreshResult"
)({
  indexId: BridgeSafeNonEmptyString,
  state: WorkspaceIndexState,
  indexed: WorkspaceIndexNonNegativeInt,
  invalidated: WorkspaceIndexNonNegativeInt,
  ignored: WorkspaceIndexNonNegativeInt
}) {}

export class WorkspaceIndexCloseRequest extends Schema.Class<WorkspaceIndexCloseRequest>(
  "WorkspaceIndexCloseRequest"
)({
  indexId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class WorkspaceIndexCloseInput extends Schema.Class<WorkspaceIndexCloseInput>(
  "WorkspaceIndexCloseInput"
)({
  indexId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class WorkspaceIndexCloseResult extends Schema.Class<WorkspaceIndexCloseResult>(
  "WorkspaceIndexCloseResult"
)({
  indexId: BridgeSafeNonEmptyString,
  closed: Schema.Boolean
}) {}

export class WorkspaceIndexSupportedResult extends Schema.Class<WorkspaceIndexSupportedResult>(
  "WorkspaceIndexSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

const stateForWorkspaceIndexPhase = (
  phase: WorkspaceIndexEventPhase
): WorkspaceIndexState | undefined => {
  switch (phase) {
    case "opened":
      return "opened"
    case "refresh-started":
      return "refreshing"
    case "refresh-completed":
      return "opened"
    case "closed":
      return "closed"
    case "entry-indexed":
    case "entry-invalidated":
      return undefined
  }
}

const WorkspaceIndexEventState = Schema.makeFilter<{
  readonly phase: WorkspaceIndexEventPhase
  readonly state?: WorkspaceIndexState | undefined
}>((value) => {
  if (value.state === undefined) {
    return true
  }
  const state = stateForWorkspaceIndexPhase(value.phase)
  if (state === undefined) {
    return `${value.phase} events must not carry state`
  }
  return value.state === state || `${value.phase} events require ${state} state`
})

export class WorkspaceIndexEvent extends Schema.Class<WorkspaceIndexEvent>("WorkspaceIndexEvent")(
  Schema.Struct({
    type: WorkspaceIndexEventType,
    timestamp: WorkspaceIndexTimestamp,
    indexId: BridgeSafeNonEmptyString,
    root: Schema.optionalKey(PrintableNonEmptyString),
    path: Schema.optionalKey(PrintableNonEmptyString),
    phase: WorkspaceIndexEventPhase,
    state: Schema.optionalKey(WorkspaceIndexState),
    indexed: Schema.optionalKey(WorkspaceIndexNonNegativeInt),
    invalidated: Schema.optionalKey(WorkspaceIndexNonNegativeInt),
    ignored: Schema.optionalKey(WorkspaceIndexNonNegativeInt)
  }).check(WorkspaceIndexEventState)
) {}
