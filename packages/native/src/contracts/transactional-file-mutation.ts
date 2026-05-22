import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const TransactionalFileMutationActorKind = Schema.Literals([
  "workspace",
  "extension",
  "tool",
  "process",
  "native",
  "app",
  "window"
])
export type TransactionalFileMutationActorKind = typeof TransactionalFileMutationActorKind.Type

export const TransactionalFileMutationState = Schema.Literals([
  "prepared",
  "committing",
  "committed",
  "rolling-back",
  "rolled-back",
  "conflicted"
])
export type TransactionalFileMutationState = typeof TransactionalFileMutationState.Type

export const TransactionalFileMutationEventPhase = Schema.Literals([
  "prepared",
  "commit-started",
  "committed",
  "rollback-started",
  "rolled-back",
  "conflicted"
])
export type TransactionalFileMutationEventPhase = typeof TransactionalFileMutationEventPhase.Type

export const TransactionalFileMutationEventType = Schema.Literal(
  "transactional-file-mutation-event"
)
export type TransactionalFileMutationEventType = typeof TransactionalFileMutationEventType.Type

const TransactionalFileMutationNonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const TransactionalFileMutationTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)

export class TransactionalFileMutationActor extends Schema.Class<TransactionalFileMutationActor>(
  "TransactionalFileMutationActor"
)({
  kind: TransactionalFileMutationActorKind,
  id: PrintableNonEmptyString
}) {}

export class TransactionalFileMutationDiff extends Schema.Class<TransactionalFileMutationDiff>(
  "TransactionalFileMutationDiff"
)({
  format: Schema.Literal("unified"),
  text: Schema.String,
  additions: TransactionalFileMutationNonNegativeInt,
  deletions: TransactionalFileMutationNonNegativeInt
}) {}

export class TransactionalFileMutationPrepareRequest extends Schema.Class<TransactionalFileMutationPrepareRequest>(
  "TransactionalFileMutationPrepareRequest"
)({
  actor: TransactionalFileMutationActor,
  path: PrintableNonEmptyString,
  replacementBytes: Schema.Uint8Array,
  expectedSourceHash: Schema.optionalKey(BridgeSafeNonEmptyString),
  mutationId: Schema.optionalKey(BridgeSafeNonEmptyString),
  ownerScope: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class TransactionalFileMutationPrepareInput extends Schema.Class<TransactionalFileMutationPrepareInput>(
  "TransactionalFileMutationPrepareInput"
)({
  actor: TransactionalFileMutationActor,
  path: PrintableNonEmptyString,
  replacementBytes: Schema.Uint8Array,
  expectedSourceHash: Schema.optionalKey(BridgeSafeNonEmptyString),
  mutationId: Schema.optionalKey(BridgeSafeNonEmptyString),
  ownerScope: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class TransactionalFileMutationPrepareResult extends Schema.Class<TransactionalFileMutationPrepareResult>(
  "TransactionalFileMutationPrepareResult"
)({
  mutationId: BridgeSafeNonEmptyString,
  path: PrintableNonEmptyString,
  state: Schema.Literal("prepared"),
  ownerScope: BridgeSafeNonEmptyString,
  sourceHash: BridgeSafeNonEmptyString,
  replacementHash: BridgeSafeNonEmptyString,
  diff: TransactionalFileMutationDiff
}) {}

export class TransactionalFileMutationCommitRequest extends Schema.Class<TransactionalFileMutationCommitRequest>(
  "TransactionalFileMutationCommitRequest"
)({
  actor: TransactionalFileMutationActor,
  mutationId: BridgeSafeNonEmptyString,
  expectedSourceHash: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class TransactionalFileMutationCommitInput extends Schema.Class<TransactionalFileMutationCommitInput>(
  "TransactionalFileMutationCommitInput"
)({
  actor: TransactionalFileMutationActor,
  mutationId: BridgeSafeNonEmptyString,
  expectedSourceHash: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class TransactionalFileMutationCommitResult extends Schema.Class<TransactionalFileMutationCommitResult>(
  "TransactionalFileMutationCommitResult"
)({
  mutationId: BridgeSafeNonEmptyString,
  path: PrintableNonEmptyString,
  state: Schema.Literal("committed"),
  committed: Schema.Boolean
}) {}

export class TransactionalFileMutationRollbackRequest extends Schema.Class<TransactionalFileMutationRollbackRequest>(
  "TransactionalFileMutationRollbackRequest"
)({
  actor: TransactionalFileMutationActor,
  mutationId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class TransactionalFileMutationRollbackInput extends Schema.Class<TransactionalFileMutationRollbackInput>(
  "TransactionalFileMutationRollbackInput"
)({
  actor: TransactionalFileMutationActor,
  mutationId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class TransactionalFileMutationRollbackResult extends Schema.Class<TransactionalFileMutationRollbackResult>(
  "TransactionalFileMutationRollbackResult"
)({
  mutationId: BridgeSafeNonEmptyString,
  path: PrintableNonEmptyString,
  state: Schema.Literal("rolled-back"),
  rolledBack: Schema.Boolean
}) {}

export class TransactionalFileMutationSupportedResult extends Schema.Class<TransactionalFileMutationSupportedResult>(
  "TransactionalFileMutationSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

const stateForTransactionalFileMutationPhase = (
  phase: TransactionalFileMutationEventPhase
): TransactionalFileMutationState => {
  switch (phase) {
    case "prepared":
      return "prepared"
    case "commit-started":
      return "committing"
    case "committed":
      return "committed"
    case "rollback-started":
      return "rolling-back"
    case "rolled-back":
      return "rolled-back"
    case "conflicted":
      return "conflicted"
  }
}

const TransactionalFileMutationEventState = Schema.makeFilter<{
  readonly phase: TransactionalFileMutationEventPhase
  readonly state?: TransactionalFileMutationState | undefined
}>((value) => {
  const state = stateForTransactionalFileMutationPhase(value.phase)
  return (
    value.state === undefined ||
    value.state === state ||
    `${value.phase} events require ${state} state`
  )
})

export class TransactionalFileMutationEvent extends Schema.Class<TransactionalFileMutationEvent>(
  "TransactionalFileMutationEvent"
)(
  Schema.Struct({
    type: TransactionalFileMutationEventType,
    timestamp: TransactionalFileMutationTimestamp,
    mutationId: BridgeSafeNonEmptyString,
    path: Schema.optionalKey(PrintableNonEmptyString),
    phase: TransactionalFileMutationEventPhase,
    state: Schema.optionalKey(TransactionalFileMutationState),
    sourceHash: Schema.optionalKey(BridgeSafeNonEmptyString),
    replacementHash: Schema.optionalKey(BridgeSafeNonEmptyString),
    diff: Schema.optionalKey(TransactionalFileMutationDiff)
  }).check(TransactionalFileMutationEventState)
) {}
