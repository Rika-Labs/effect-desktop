import { Schema } from "effect"

import { BridgeSafeNonEmptyString } from "./strings.js"

const ArgString = Schema.NonEmptyString.check(
  Schema.makeFilter(
    (value) => !hasControlCharacter(value) || "must not contain Unicode control characters"
  )
)

const hasControlCharacter = (value: string): boolean => /\p{Cc}/u.test(value)

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
