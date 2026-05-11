import { Schema } from "effect"

export const PowerMonitorMethod = Schema.Literals([
  "onSuspend",
  "onResume",
  "onShutdown",
  "onPowerSourceChanged"
])

export const PowerMonitorSource = Schema.Literals(["ac", "battery", "unknown"])

export type PowerMonitorMethod = Schema.Schema.Type<typeof PowerMonitorMethod>
export type PowerMonitorSource = Schema.Schema.Type<typeof PowerMonitorSource>

const PowerMonitorReason = Schema.NonEmptyString

export class PowerMonitorSuspendEvent extends Schema.Class<PowerMonitorSuspendEvent>(
  "PowerMonitorSuspendEvent"
)({
  reason: Schema.optionalKey(PowerMonitorReason)
}) {}

export class PowerMonitorResumeEvent extends Schema.Class<PowerMonitorResumeEvent>(
  "PowerMonitorResumeEvent"
)({
  reason: Schema.optionalKey(PowerMonitorReason)
}) {}

export class PowerMonitorShutdownEvent extends Schema.Class<PowerMonitorShutdownEvent>(
  "PowerMonitorShutdownEvent"
)({
  reason: Schema.optionalKey(PowerMonitorReason)
}) {}

export class PowerMonitorSourceChangedEvent extends Schema.Class<PowerMonitorSourceChangedEvent>(
  "PowerMonitorSourceChangedEvent"
)({
  source: PowerMonitorSource
}) {}

export class PowerMonitorIsSupportedInput extends Schema.Class<PowerMonitorIsSupportedInput>(
  "PowerMonitorIsSupportedInput"
)({
  method: PowerMonitorMethod
}) {}

export class PowerMonitorSupportedResult extends Schema.Class<PowerMonitorSupportedResult>(
  "PowerMonitorSupportedResult"
)({
  supported: Schema.Boolean
}) {}
