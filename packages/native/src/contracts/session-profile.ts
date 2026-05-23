import { ResourceHandleSchema, type ResourceHandle } from "@orika/core"
import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString } from "./strings.js"

export const SessionProfileResource = ResourceHandleSchema("session-profile", "open")
export type SessionProfileHandle = ResourceHandle<"session-profile", "open">

export const SessionProfileEventPhase = Schema.Literals(["opened", "closed", "failed"])
export type SessionProfileEventPhase = typeof SessionProfileEventPhase.Type

export class SessionProfileFromPartitionInput extends Schema.Class<SessionProfileFromPartitionInput>(
  "SessionProfileFromPartitionInput"
)({
  partition: BridgeSafeNonEmptyString,
  ownerScope: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}
export type SessionProfileFromPartitionOptions = Schema.Schema.Type<
  typeof SessionProfileFromPartitionInput
>

export class SessionProfileHandleInput extends Schema.Class<SessionProfileHandleInput>(
  "SessionProfileHandleInput"
)({
  profile: SessionProfileResource,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}
export type SessionProfileHandleOptions = Schema.Schema.Type<typeof SessionProfileHandleInput>

export class SessionProfileList extends Schema.Class<SessionProfileList>("SessionProfileList")({
  profiles: Schema.Array(SessionProfileResource)
}) {}

export class SessionProfileSupportedResult extends Schema.Class<SessionProfileSupportedResult>(
  "SessionProfileSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

const SessionProfileEventBase = {
  type: Schema.Literal("session-profile-event"),
  timestamp: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
}

export class SessionProfileOpenedEvent extends Schema.Class<SessionProfileOpenedEvent>(
  "SessionProfileOpenedEvent"
)({
  ...SessionProfileEventBase,
  phase: Schema.Literal("opened"),
  profile: SessionProfileResource,
  partition: BridgeSafeNonEmptyString,
  message: Schema.optionalKey(Schema.Never)
}) {}

export class SessionProfileClosedEvent extends Schema.Class<SessionProfileClosedEvent>(
  "SessionProfileClosedEvent"
)({
  ...SessionProfileEventBase,
  phase: Schema.Literal("closed"),
  profile: SessionProfileResource,
  partition: BridgeSafeNonEmptyString,
  message: Schema.optionalKey(Schema.Never)
}) {}

export class SessionProfileFailedEvent extends Schema.Class<SessionProfileFailedEvent>(
  "SessionProfileFailedEvent"
)({
  ...SessionProfileEventBase,
  phase: Schema.Literal("failed"),
  message: BridgeSafeString,
  profile: Schema.optionalKey(Schema.Never),
  partition: Schema.optionalKey(Schema.Never)
}) {}

export const SessionProfileEvent = Schema.Union([
  SessionProfileOpenedEvent,
  SessionProfileClosedEvent,
  SessionProfileFailedEvent
])
export type SessionProfileEvent = typeof SessionProfileEvent.Type
