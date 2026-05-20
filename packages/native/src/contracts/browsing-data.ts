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

export class BrowsingDataEvent extends Schema.Class<BrowsingDataEvent>("BrowsingDataEvent")({
  type: Schema.Literal("browsing-data-event"),
  timestamp: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  phase: BrowsingDataEventPhase,
  profile: SessionProfileResource,
  cleared: Schema.Array(BrowsingDataType),
  unsupported: Schema.Array(BrowsingDataType),
  message: Schema.optionalKey(BridgeSafeString)
}) {}
