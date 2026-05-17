import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const ScopedAccessGrantActorKind = Schema.Literals([
  "workspace",
  "extension",
  "tool",
  "process",
  "native",
  "app",
  "window"
])
export type ScopedAccessGrantActorKind = typeof ScopedAccessGrantActorKind.Type

export const ScopedAccessGrantScopeKind = Schema.Literals(["file", "directory"])
export type ScopedAccessGrantScopeKind = typeof ScopedAccessGrantScopeKind.Type

export const ScopedAccessGrantAccess = Schema.Literals(["read", "write", "read-write"])
export type ScopedAccessGrantAccess = typeof ScopedAccessGrantAccess.Type

export const ScopedAccessGrantState = Schema.Literals(["granted", "resolved", "revoked"])
export type ScopedAccessGrantState = typeof ScopedAccessGrantState.Type

export const ScopedAccessGrantEventPhase = Schema.Literals(["granted", "resolved", "revoked"])
export type ScopedAccessGrantEventPhase = typeof ScopedAccessGrantEventPhase.Type

export const ScopedAccessGrantEventType = Schema.Literal("scoped-access-grant-event")
export type ScopedAccessGrantEventType = typeof ScopedAccessGrantEventType.Type

const ScopedAccessGrantTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)

export class ScopedAccessGrantActor extends Schema.Class<ScopedAccessGrantActor>(
  "ScopedAccessGrantActor"
)({
  kind: ScopedAccessGrantActorKind,
  id: PrintableNonEmptyString
}) {}

export class ScopedAccessGrantScope extends Schema.Class<ScopedAccessGrantScope>(
  "ScopedAccessGrantScope"
)({
  path: PrintableNonEmptyString,
  kind: ScopedAccessGrantScopeKind,
  access: ScopedAccessGrantAccess
}) {}

export class ScopedAccessGrantGrantRequest extends Schema.Class<ScopedAccessGrantGrantRequest>(
  "ScopedAccessGrantGrantRequest"
)({
  actor: ScopedAccessGrantActor,
  scope: ScopedAccessGrantScope,
  grantId: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ScopedAccessGrantGrantInput extends Schema.Class<ScopedAccessGrantGrantInput>(
  "ScopedAccessGrantGrantInput"
)({
  actor: ScopedAccessGrantActor,
  scope: ScopedAccessGrantScope,
  grantId: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ScopedAccessGrantResolveRequest extends Schema.Class<ScopedAccessGrantResolveRequest>(
  "ScopedAccessGrantResolveRequest"
)({
  grantId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ScopedAccessGrantResolveInput extends Schema.Class<ScopedAccessGrantResolveInput>(
  "ScopedAccessGrantResolveInput"
)({
  grantId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ScopedAccessGrantRevokeRequest extends Schema.Class<ScopedAccessGrantRevokeRequest>(
  "ScopedAccessGrantRevokeRequest"
)({
  grantId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ScopedAccessGrantRevokeInput extends Schema.Class<ScopedAccessGrantRevokeInput>(
  "ScopedAccessGrantRevokeInput"
)({
  grantId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ScopedAccessGrantGrantResult extends Schema.Class<ScopedAccessGrantGrantResult>(
  "ScopedAccessGrantGrantResult"
)({
  grantId: BridgeSafeNonEmptyString,
  scope: ScopedAccessGrantScope,
  state: Schema.Literal("granted")
}) {}

export class ScopedAccessGrantResolveResult extends Schema.Class<ScopedAccessGrantResolveResult>(
  "ScopedAccessGrantResolveResult"
)({
  grantId: BridgeSafeNonEmptyString,
  scope: ScopedAccessGrantScope,
  state: Schema.Literal("resolved"),
  revalidated: Schema.Boolean
}) {}

export class ScopedAccessGrantRevokeResult extends Schema.Class<ScopedAccessGrantRevokeResult>(
  "ScopedAccessGrantRevokeResult"
)({
  grantId: BridgeSafeNonEmptyString,
  revoked: Schema.Boolean
}) {}

export class ScopedAccessGrantSupportedResult extends Schema.Class<ScopedAccessGrantSupportedResult>(
  "ScopedAccessGrantSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class ScopedAccessGrantEvent extends Schema.Class<ScopedAccessGrantEvent>(
  "ScopedAccessGrantEvent"
)({
  type: ScopedAccessGrantEventType,
  timestamp: ScopedAccessGrantTimestamp,
  grantId: BridgeSafeNonEmptyString,
  path: Schema.optionalKey(PrintableNonEmptyString),
  phase: ScopedAccessGrantEventPhase,
  state: Schema.optionalKey(ScopedAccessGrantState)
}) {}
