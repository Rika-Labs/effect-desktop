import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const EgressPolicyActorKind = Schema.Literals([
  "workspace",
  "extension",
  "tool",
  "process",
  "native",
  "app",
  "window"
])
export type EgressPolicyActorKind = typeof EgressPolicyActorKind.Type

export const EgressPolicyProtocol = Schema.Literals(["http", "https", "ws", "wss", "tcp", "udp"])
export type EgressPolicyProtocol = typeof EgressPolicyProtocol.Type

export const EgressPolicyOutcome = Schema.Literals(["allowed", "denied"])
export type EgressPolicyOutcome = typeof EgressPolicyOutcome.Type

export const EgressPolicyEventType = Schema.Literal("decision-recorded")
export type EgressPolicyEventType = typeof EgressPolicyEventType.Type

const EgressPolicyPort = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(65_535)
)
const EgressPolicyTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)
const EgressPolicyHostPatterns = Schema.Array(PrintableNonEmptyString).check(Schema.isNonEmpty())

export class EgressPolicyActor extends Schema.Class<EgressPolicyActor>("EgressPolicyActor")({
  kind: EgressPolicyActorKind,
  id: PrintableNonEmptyString
}) {}

export class EgressPolicyDestination extends Schema.Class<EgressPolicyDestination>(
  "EgressPolicyDestination"
)({
  protocol: EgressPolicyProtocol,
  host: PrintableNonEmptyString,
  port: Schema.optionalKey(EgressPolicyPort),
  path: Schema.optionalKey(BridgeSafeString)
}) {}

export class EgressPolicyRule extends Schema.Class<EgressPolicyRule>("EgressPolicyRule")({
  id: PrintableNonEmptyString,
  effect: Schema.Literals(["allow", "deny"]),
  hosts: EgressPolicyHostPatterns,
  protocols: Schema.optionalKey(Schema.Array(EgressPolicyProtocol)),
  ports: Schema.optionalKey(Schema.Array(EgressPolicyPort)),
  actor: Schema.optionalKey(EgressPolicyActor),
  reason: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class EgressPolicyDecisionRequest extends Schema.Class<EgressPolicyDecisionRequest>(
  "EgressPolicyDecisionRequest"
)({
  actor: EgressPolicyActor,
  destination: EgressPolicyDestination,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class EgressPolicyDecisionInput extends Schema.Class<EgressPolicyDecisionInput>(
  "EgressPolicyDecisionInput"
)({
  actor: EgressPolicyActor,
  destination: EgressPolicyDestination,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class EgressPolicyDecisionResult extends Schema.Class<EgressPolicyDecisionResult>(
  "EgressPolicyDecisionResult"
)({
  decisionId: BridgeSafeNonEmptyString,
  outcome: EgressPolicyOutcome,
  actor: EgressPolicyActor,
  destination: EgressPolicyDestination,
  rule: EgressPolicyRule,
  reason: BridgeSafeNonEmptyString
}) {}

export class EgressPolicyRecordRequest extends Schema.Class<EgressPolicyRecordRequest>(
  "EgressPolicyRecordRequest"
)({
  decisionId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class EgressPolicyRecordInput extends Schema.Class<EgressPolicyRecordInput>(
  "EgressPolicyRecordInput"
)({
  decisionId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class EgressPolicyRecordResult extends Schema.Class<EgressPolicyRecordResult>(
  "EgressPolicyRecordResult"
)({
  decisionId: BridgeSafeNonEmptyString,
  recorded: Schema.Boolean
}) {}

export class EgressPolicySupportedResult extends Schema.Class<EgressPolicySupportedResult>(
  "EgressPolicySupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class EgressPolicyDecisionRecordedEvent extends Schema.Class<EgressPolicyDecisionRecordedEvent>(
  "EgressPolicyDecisionRecordedEvent"
)({
  type: EgressPolicyEventType,
  timestamp: EgressPolicyTimestamp,
  decision: EgressPolicyDecisionResult
}) {}

export const EgressPolicyEvent = EgressPolicyDecisionRecordedEvent
export type EgressPolicyEvent = typeof EgressPolicyEvent.Type
