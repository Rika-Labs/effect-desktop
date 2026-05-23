import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

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

export class ScopedAccessGrantSupportedResult extends Schema.Class<ScopedAccessGrantSupportedResult>(
  "ScopedAccessGrantSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

const ScopedAccessGrantEventPhaseState = Schema.makeFilter<{
  readonly phase: ScopedAccessGrantEventPhase
  readonly state?: ScopedAccessGrantState | undefined
}>((value) => {
  const expectedState = value.phase
  return (
    value.state === expectedState ||
    `scoped access grant ${value.phase} events require ${expectedState} state`
  )
})

export class ScopedAccessGrantEvent extends Schema.Class<ScopedAccessGrantEvent>(
  "ScopedAccessGrantEvent"
)(
  Schema.Struct({
    type: ScopedAccessGrantEventType,
    timestamp: ScopedAccessGrantTimestamp,
    grantId: BridgeSafeNonEmptyString,
    path: Schema.optionalKey(PrintableNonEmptyString),
    phase: ScopedAccessGrantEventPhase,
    state: Schema.optionalKey(ScopedAccessGrantState)
  }).check(ScopedAccessGrantEventPhaseState)
) {}
