import { ResourceHandleSchema, type ResourceHandle } from "@orika/core"
import { Schema } from "effect"

import { BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const ResidentLifecycleProcessPolicy = Schema.Literals([
  "quit-with-last-window",
  "keep-running"
])
export type ResidentLifecycleProcessPolicy = typeof ResidentLifecycleProcessPolicy.Type

export const ResidentLifecycleWindowPolicy = Schema.Literals([
  "quit-on-last-window",
  "close-to-background"
])
export type ResidentLifecycleWindowPolicy = typeof ResidentLifecycleWindowPolicy.Type

export const ResidentLifecycleBackgroundAvailability = Schema.Literals([
  "disabled",
  "tray",
  "menu-bar",
  "headless"
])
export type ResidentLifecycleBackgroundAvailability =
  typeof ResidentLifecycleBackgroundAvailability.Type

export const ResidentLifecyclePhase = Schema.Literals(["enabled", "disabled", "changed", "failed"])
export type ResidentLifecyclePhase = typeof ResidentLifecyclePhase.Type

export const ResidentLifecycleEventType = Schema.Literal("resident-lifecycle-event")
export type ResidentLifecycleEventType = typeof ResidentLifecycleEventType.Type

const ResidentLifecycleTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)
const ResidentLifecyclePrintableIdentifier = PrintableNonEmptyString.check(
  Schema.makeFilter((value) =>
    value.trim().length > 0 ? undefined : "must contain non-whitespace characters"
  )
)

export const ResidentLifecycleResource = ResourceHandleSchema(
  "resident-lifecycle-policy",
  "enabled"
)
export type ResidentLifecycleHandle = ResourceHandle<"resident-lifecycle-policy", "enabled">

export class ResidentLifecyclePolicy extends Schema.Class<ResidentLifecyclePolicy>(
  "ResidentLifecyclePolicy"
)({
  process: ResidentLifecycleProcessPolicy,
  windows: ResidentLifecycleWindowPolicy,
  background: ResidentLifecycleBackgroundAvailability,
  launchAtLogin: Schema.optionalKey(Schema.Boolean)
}) {}

export class ResidentLifecycleEnableRequest extends Schema.Class<ResidentLifecycleEnableRequest>(
  "ResidentLifecycleEnableRequest"
)({
  policy: ResidentLifecyclePolicy,
  ownerScope: Schema.optionalKey(ResidentLifecyclePrintableIdentifier),
  traceId: Schema.optionalKey(ResidentLifecyclePrintableIdentifier)
}) {}

export class ResidentLifecycleDisableRequest extends Schema.Class<ResidentLifecycleDisableRequest>(
  "ResidentLifecycleDisableRequest"
)({
  traceId: Schema.optionalKey(ResidentLifecyclePrintableIdentifier)
}) {}

export class ResidentLifecycleState extends Schema.Class<ResidentLifecycleState>(
  "ResidentLifecycleState"
)({
  enabled: Schema.Boolean,
  policy: Schema.optionalKey(ResidentLifecyclePolicy)
}) {}

export class ResidentLifecycleSupportedResult extends Schema.Class<ResidentLifecycleSupportedResult>(
  "ResidentLifecycleSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class ResidentLifecycleEvent extends Schema.Class<ResidentLifecycleEvent>(
  "ResidentLifecycleEvent"
)({
  type: ResidentLifecycleEventType,
  timestamp: ResidentLifecycleTimestamp,
  phase: ResidentLifecyclePhase,
  state: ResidentLifecycleState,
  traceId: ResidentLifecyclePrintableIdentifier,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}
