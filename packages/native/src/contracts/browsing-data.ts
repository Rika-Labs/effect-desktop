import { Schema } from "effect"

import { SessionProfileResource } from "./session-profile.js"
import { BridgeSafeNonEmptyString, BridgeSafeString } from "./strings.js"

export const BrowsingDataType = Schema.Literals([
  "cache",
  "cookies",
  "localStorage",
  "indexedDb",
  "history",
  "serviceWorkers"
])
export type BrowsingDataType = typeof BrowsingDataType.Type

const BrowsingDataEventPhase = Schema.Literals(["cleared", "failed"])
export type BrowsingDataEventPhase = typeof BrowsingDataEventPhase.Type

export class BrowsingDataClearInput extends Schema.Class<BrowsingDataClearInput>(
  "BrowsingDataClearInput"
)({
  profile: SessionProfileResource,
  types: Schema.NonEmptyArray(BrowsingDataType),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}
export type BrowsingDataClearOptions = Schema.Schema.Type<typeof BrowsingDataClearInput>

export class BrowsingDataEstimateInput extends Schema.Class<BrowsingDataEstimateInput>(
  "BrowsingDataEstimateInput"
)({
  profile: SessionProfileResource,
  types: Schema.optionalKey(Schema.NonEmptyArray(BrowsingDataType)),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class BrowsingDataTypeEstimate extends Schema.Class<BrowsingDataTypeEstimate>(
  "BrowsingDataTypeEstimate"
)({
  type: BrowsingDataType,
  supported: Schema.Boolean,
  bytes: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
}) {}

export class BrowsingDataClearResult extends Schema.Class<BrowsingDataClearResult>(
  "BrowsingDataClearResult"
)({
  cleared: Schema.Array(BrowsingDataType),
  unsupported: Schema.Array(BrowsingDataType)
}) {}

export class BrowsingDataEstimateResult extends Schema.Class<BrowsingDataEstimateResult>(
  "BrowsingDataEstimateResult"
)({
  estimates: Schema.Array(BrowsingDataTypeEstimate)
}) {}

export class BrowsingDataListTypesResult extends Schema.Class<BrowsingDataListTypesResult>(
  "BrowsingDataListTypesResult"
)({
  types: Schema.Array(BrowsingDataType)
}) {}

export class BrowsingDataSupportedResult extends Schema.Class<BrowsingDataSupportedResult>(
  "BrowsingDataSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

const BrowsingDataEventPhasePayload = Schema.makeFilter<{
  readonly phase: BrowsingDataEventPhase
  readonly cleared?: readonly BrowsingDataType[] | undefined
  readonly unsupported?: readonly BrowsingDataType[] | undefined
  readonly message?: string | undefined
}>((value) => {
  switch (value.phase) {
    case "cleared":
      return (
        (value.cleared !== undefined &&
          value.unsupported !== undefined &&
          value.message === undefined) ||
        "cleared browsing data events require cleared and unsupported arrays only"
      )
    case "failed":
      return (
        (value.cleared === undefined &&
          value.unsupported === undefined &&
          value.message !== undefined) ||
        "failed browsing data events require message and no cleared result arrays"
      )
  }
})

export class BrowsingDataEvent extends Schema.Class<BrowsingDataEvent>("BrowsingDataEvent")(
  Schema.Struct({
    type: Schema.Literal("browsing-data-event"),
    timestamp: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
    phase: BrowsingDataEventPhase,
    profile: SessionProfileResource,
    cleared: Schema.optionalKey(Schema.Array(BrowsingDataType)),
    unsupported: Schema.optionalKey(Schema.Array(BrowsingDataType)),
    message: Schema.optionalKey(BridgeSafeString)
  }).check(BrowsingDataEventPhasePayload)
) {}
