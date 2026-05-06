import { Schema } from "effect"

export const PowerMonitorSource = Schema.Literals(["ac", "battery", "unknown"])

export type PowerMonitorSource = Schema.Schema.Type<typeof PowerMonitorSource>

export class PowerMonitorSuspendEvent extends Schema.Class<PowerMonitorSuspendEvent>(
  "PowerMonitorSuspendEvent"
)({
  reason: Schema.optionalKey(Schema.String)
}) {}

export class PowerMonitorResumeEvent extends Schema.Class<PowerMonitorResumeEvent>(
  "PowerMonitorResumeEvent"
)({
  reason: Schema.optionalKey(Schema.String)
}) {}

export class PowerMonitorShutdownEvent extends Schema.Class<PowerMonitorShutdownEvent>(
  "PowerMonitorShutdownEvent"
)({
  reason: Schema.optionalKey(Schema.String)
}) {}

export class PowerMonitorSourceChangedEvent extends Schema.Class<PowerMonitorSourceChangedEvent>(
  "PowerMonitorSourceChangedEvent"
)({
  source: PowerMonitorSource
}) {}
