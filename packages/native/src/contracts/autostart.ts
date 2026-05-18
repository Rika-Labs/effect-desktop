import { Schema } from "effect"

import { BridgeSafeNonEmptyString } from "./strings.js"

// eslint-disable-next-line no-control-regex -- Launch args must reject NUL.
const ArgString = Schema.NonEmptyString.check(Schema.isPattern(/^[^\u0000]*$/))

export class AutostartEnableInput extends Schema.Class<AutostartEnableInput>(
  "AutostartEnableInput"
)({
  args: Schema.optionalKey(Schema.Array(ArgString))
}) {}

export type AutostartEnableOptions = Schema.Schema.Type<typeof AutostartEnableInput>

export const AutostartMechanism = Schema.Literals([
  "macos-login-item",
  "windows-run-key",
  "linux-xdg-autostart",
  "unsupported"
])

export class AutostartStatus extends Schema.Class<AutostartStatus>("AutostartStatus")({
  enabled: Schema.Boolean,
  mechanism: AutostartMechanism
}) {}

export const AutostartEventPhase = Schema.Literals(["checked", "enabled", "disabled", "failed"])

export class AutostartEvent extends Schema.Class<AutostartEvent>("AutostartEvent")({
  phase: AutostartEventPhase,
  mechanism: Schema.optionalKey(AutostartMechanism),
  reason: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}
