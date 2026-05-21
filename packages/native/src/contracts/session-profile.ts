import { ResourceHandleSchema, type ResourceHandle } from "@effect-desktop/core"
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

export class SessionProfileEvent extends Schema.Class<SessionProfileEvent>("SessionProfileEvent")({
  type: Schema.Literal("session-profile-event"),
  timestamp: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  phase: SessionProfileEventPhase,
  profile: Schema.optionalKey(SessionProfileResource),
  partition: Schema.optionalKey(BridgeSafeNonEmptyString),
  message: Schema.optionalKey(BridgeSafeString)
}) {}
