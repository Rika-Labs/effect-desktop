import { Schema } from "effect"

import { SessionProfileResource } from "./session-profile.js"
import { BridgeSafeNonEmptyString, BridgeSafeString } from "./strings.js"

export const SessionPermissionKind = Schema.Literals([
  "camera",
  "microphone",
  "notifications",
  "geolocation",
  "clipboard-read",
  "clipboard-write",
  "display-capture"
])
export type SessionPermissionKind = typeof SessionPermissionKind.Type

export const SessionPermissionDecision = Schema.Literals(["grant", "deny"])
export type SessionPermissionDecision = typeof SessionPermissionDecision.Type

export const SessionPermissionRequestStatus = Schema.Literals(["pending"])
export type SessionPermissionRequestStatus = typeof SessionPermissionRequestStatus.Type

const SessionPermissionOrigin = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^(?:app|https?):\/\/[^/?#\s]+$/iu)
)

const SessionPermissionRequestId = BridgeSafeNonEmptyString

const SessionPermissionEventPhase = Schema.Literals(["requested", "decided", "failed"])
export type SessionPermissionEventPhase = typeof SessionPermissionEventPhase.Type

const SessionPermissionEventDecisionShape = Schema.makeFilter<{
  readonly phase: SessionPermissionEventPhase
  readonly decision?: SessionPermissionDecision | undefined
}>((value) => {
  if (value.phase === "decided") {
    return value.decision !== undefined || "decided session permission events require decision"
  }
  return (
    value.decision === undefined ||
    `${value.phase} session permission events must not carry decision`
  )
})

export class SessionPermissionRequestInput extends Schema.Class<SessionPermissionRequestInput>(
  "SessionPermissionRequestInput"
)({
  profile: SessionProfileResource,
  kind: SessionPermissionKind,
  origin: SessionPermissionOrigin,
  requestId: Schema.optionalKey(SessionPermissionRequestId),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class SessionPermissionDecideInput extends Schema.Class<SessionPermissionDecideInput>(
  "SessionPermissionDecideInput"
)({
  profile: SessionProfileResource,
  requestId: SessionPermissionRequestId,
  kind: SessionPermissionKind,
  origin: SessionPermissionOrigin,
  decision: SessionPermissionDecision,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class SessionPermissionListInput extends Schema.Class<SessionPermissionListInput>(
  "SessionPermissionListInput"
)({
  profile: SessionProfileResource,
  kind: Schema.optionalKey(SessionPermissionKind),
  origin: Schema.optionalKey(SessionPermissionOrigin),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class SessionPermissionRequestResult extends Schema.Class<SessionPermissionRequestResult>(
  "SessionPermissionRequestResult"
)({
  requestId: SessionPermissionRequestId,
  status: SessionPermissionRequestStatus
}) {}

export class SessionPermissionDecisionRecord extends Schema.Class<SessionPermissionDecisionRecord>(
  "SessionPermissionDecisionRecord"
)({
  profile: SessionProfileResource,
  requestId: SessionPermissionRequestId,
  kind: SessionPermissionKind,
  origin: SessionPermissionOrigin,
  decision: SessionPermissionDecision,
  decidedAt: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
}) {}

export class SessionPermissionListResult extends Schema.Class<SessionPermissionListResult>(
  "SessionPermissionListResult"
)({
  decisions: Schema.Array(SessionPermissionDecisionRecord)
}) {}

export class SessionPermissionSupportedResult extends Schema.Class<SessionPermissionSupportedResult>(
  "SessionPermissionSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class SessionPermissionEvent extends Schema.Class<SessionPermissionEvent>(
  "SessionPermissionEvent"
)(
  Schema.Struct({
    type: Schema.Literal("session-permission-event"),
    timestamp: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
    phase: SessionPermissionEventPhase,
    profile: SessionProfileResource,
    requestId: SessionPermissionRequestId,
    kind: SessionPermissionKind,
    origin: SessionPermissionOrigin,
    decision: Schema.optionalKey(SessionPermissionDecision),
    message: Schema.optionalKey(BridgeSafeString)
  }).check(SessionPermissionEventDecisionShape)
) {}
