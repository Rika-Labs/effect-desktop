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

const NetworkAuthEventPhasePayload = Schema.makeFilter<{
  readonly phase: NetworkAuthEventPhase
  readonly requestId?: string | undefined
  readonly origin?: string | undefined
  readonly decision?: NetworkAuthDecision | undefined
  readonly message?: string | undefined
}>((value) => {
  switch (value.phase) {
    case "proxy-updated":
      return (
        (value.requestId === undefined &&
          value.origin === undefined &&
          value.decision === undefined &&
          value.message === undefined) ||
        "proxy-updated network auth events must not include decision or message fields"
      )
    case "auth-decided":
    case "certificate-decided":
      return (
        (value.requestId !== undefined &&
          value.origin !== undefined &&
          value.decision !== undefined &&
          value.message === undefined) ||
        `${value.phase} network auth events require requestId, origin, and decision only`
      )
    case "failed":
      return (
        (value.requestId === undefined &&
          value.origin === undefined &&
          value.decision === undefined &&
          value.message !== undefined) ||
        "failed network auth events require message only"
      )
  }
})

export class NetworkAuthEvent extends Schema.Class<NetworkAuthEvent>("NetworkAuthEvent")(
  Schema.Struct({
    type: Schema.Literal("network-auth-event"),
    timestamp: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
    phase: NetworkAuthEventPhase,
    profile: SessionProfileResource,
    requestId: Schema.optionalKey(BridgeSafeNonEmptyString),
    origin: Schema.optionalKey(NetworkAuthOrigin),
    decision: Schema.optionalKey(NetworkAuthDecision),
    message: Schema.optionalKey(BridgeSafeString)
  }).check(NetworkAuthEventPhasePayload)
) {}
