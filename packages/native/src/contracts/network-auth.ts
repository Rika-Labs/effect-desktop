import { Schema } from "effect"

import { SessionProfileResource } from "./session-profile.js"
import { BridgeSafeNonEmptyString, BridgeSafeString } from "./strings.js"

const NetworkAuthOrigin = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^(?:app|https?):\/\/[^/?#\s]+$/iu)
)
const NetworkAuthProxyServer = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^(?:https?|socks5):\/\/[^/?#\s]+(?::\d{1,5})?$/iu)
)
const NetworkAuthFingerprint = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^sha256:[A-Fa-f0-9]{64}$/u)
)

export const NetworkAuthProxyMode = Schema.Literals(["direct", "system", "fixed"])
export type NetworkAuthProxyMode = typeof NetworkAuthProxyMode.Type

export const NetworkAuthDecision = Schema.Literals(["allow", "deny"])
export type NetworkAuthDecision = typeof NetworkAuthDecision.Type

const NetworkAuthEventPhase = Schema.Literals([
  "proxy-updated",
  "auth-decided",
  "certificate-decided",
  "failed"
])
export type NetworkAuthEventPhase = typeof NetworkAuthEventPhase.Type

export class NetworkAuthSetProxyInput extends Schema.Class<NetworkAuthSetProxyInput>(
  "NetworkAuthSetProxyInput"
)({
  profile: SessionProfileResource,
  mode: NetworkAuthProxyMode,
  server: Schema.optionalKey(NetworkAuthProxyServer),
  bypass: Schema.optionalKey(Schema.Array(BridgeSafeNonEmptyString)),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class NetworkAuthProxyResult extends Schema.Class<NetworkAuthProxyResult>(
  "NetworkAuthProxyResult"
)({
  profile: SessionProfileResource,
  mode: NetworkAuthProxyMode,
  server: Schema.optionalKey(NetworkAuthProxyServer),
  bypass: Schema.Array(BridgeSafeNonEmptyString)
}) {}

export class NetworkAuthHttpAuthInput extends Schema.Class<NetworkAuthHttpAuthInput>(
  "NetworkAuthHttpAuthInput"
)({
  profile: SessionProfileResource,
  requestId: BridgeSafeNonEmptyString,
  origin: NetworkAuthOrigin,
  realm: Schema.optionalKey(BridgeSafeString),
  decision: NetworkAuthDecision,
  username: Schema.optionalKey(BridgeSafeNonEmptyString),
  password: Schema.optionalKey(BridgeSafeString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class NetworkAuthCertificateInput extends Schema.Class<NetworkAuthCertificateInput>(
  "NetworkAuthCertificateInput"
)({
  profile: SessionProfileResource,
  requestId: BridgeSafeNonEmptyString,
  origin: NetworkAuthOrigin,
  fingerprintSha256: NetworkAuthFingerprint,
  decision: NetworkAuthDecision,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class NetworkAuthDecisionRecord extends Schema.Class<NetworkAuthDecisionRecord>(
  "NetworkAuthDecisionRecord"
)({
  profile: SessionProfileResource,
  requestId: BridgeSafeNonEmptyString,
  origin: NetworkAuthOrigin,
  kind: Schema.Literals(["http-auth", "certificate"]),
  decision: NetworkAuthDecision,
  decidedAt: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
}) {}

export class NetworkAuthSupportedResult extends Schema.Class<NetworkAuthSupportedResult>(
  "NetworkAuthSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

const NetworkAuthEventBase = {
  type: Schema.Literal("network-auth-event"),
  timestamp: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  profile: SessionProfileResource
}

export class NetworkAuthProxyUpdatedEvent extends Schema.Class<NetworkAuthProxyUpdatedEvent>(
  "NetworkAuthProxyUpdatedEvent"
)({
  ...NetworkAuthEventBase,
  phase: Schema.Literal("proxy-updated"),
  requestId: Schema.optionalKey(Schema.Never),
  origin: Schema.optionalKey(Schema.Never),
  decision: Schema.optionalKey(Schema.Never),
  message: Schema.optionalKey(Schema.Never)
}) {}

export class NetworkAuthAuthDecidedEvent extends Schema.Class<NetworkAuthAuthDecidedEvent>(
  "NetworkAuthAuthDecidedEvent"
)({
  ...NetworkAuthEventBase,
  phase: Schema.Literal("auth-decided"),
  requestId: BridgeSafeNonEmptyString,
  origin: NetworkAuthOrigin,
  decision: NetworkAuthDecision,
  message: Schema.optionalKey(Schema.Never)
}) {}

export class NetworkAuthCertificateDecidedEvent extends Schema.Class<NetworkAuthCertificateDecidedEvent>(
  "NetworkAuthCertificateDecidedEvent"
)({
  ...NetworkAuthEventBase,
  phase: Schema.Literal("certificate-decided"),
  requestId: BridgeSafeNonEmptyString,
  origin: NetworkAuthOrigin,
  decision: NetworkAuthDecision,
  message: Schema.optionalKey(Schema.Never)
}) {}

export class NetworkAuthFailedEvent extends Schema.Class<NetworkAuthFailedEvent>(
  "NetworkAuthFailedEvent"
)({
  ...NetworkAuthEventBase,
  phase: Schema.Literal("failed"),
  message: BridgeSafeString,
  requestId: Schema.optionalKey(Schema.Never),
  origin: Schema.optionalKey(Schema.Never),
  decision: Schema.optionalKey(Schema.Never)
}) {}

export const NetworkAuthEvent = Schema.Union([
  NetworkAuthProxyUpdatedEvent,
  NetworkAuthAuthDecidedEvent,
  NetworkAuthCertificateDecidedEvent,
  NetworkAuthFailedEvent
])
export type NetworkAuthEvent = typeof NetworkAuthEvent.Type
