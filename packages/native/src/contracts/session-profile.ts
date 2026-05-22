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

const SessionProfileEventPhasePayload = Schema.makeFilter<{
  readonly phase: SessionProfileEventPhase
  readonly profile?: SessionProfileHandle | undefined
  readonly partition?: string | undefined
  readonly message?: string | undefined
}>((value) => {
  switch (value.phase) {
    case "opened":
    case "closed":
      return (
        (value.profile !== undefined &&
          value.partition !== undefined &&
          value.message === undefined) ||
        `${value.phase} session profile events require profile and partition only`
      )
    case "failed":
      return (
        (value.profile === undefined &&
          value.partition === undefined &&
          value.message !== undefined) ||
        "failed session profile events require message only"
      )
  }
})

export class SessionProfileEvent extends Schema.Class<SessionProfileEvent>("SessionProfileEvent")(
  Schema.Struct({
    type: Schema.Literal("session-profile-event"),
    timestamp: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
    phase: SessionProfileEventPhase,
    profile: Schema.optionalKey(SessionProfileResource),
    partition: Schema.optionalKey(BridgeSafeNonEmptyString),
    message: Schema.optionalKey(BridgeSafeString)
  }).check(SessionProfileEventPhasePayload)
) {}
