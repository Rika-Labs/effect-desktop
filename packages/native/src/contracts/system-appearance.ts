import { Schema } from "effect"

export const SystemAppearanceMethod = Schema.Literals([
  "getAppearance",
  "getAccentColor",
  "getReducedMotion",
  "getReducedTransparency",
  "onAppearanceChanged"
])

export const SystemAppearanceMode = Schema.Literals(["light", "dark", "highContrast"])

export type SystemAppearanceMethod = Schema.Schema.Type<typeof SystemAppearanceMethod>
export type SystemAppearanceMode = Schema.Schema.Type<typeof SystemAppearanceMode>

const SystemAppearanceColorChannel = Schema.Number.check(
  Schema.isFinite(),
  Schema.isBetween({ minimum: 0, maximum: 1 })
)

export class SystemAppearanceColor extends Schema.Class<SystemAppearanceColor>(
  "SystemAppearanceColor"
)({
  r: SystemAppearanceColorChannel,
  g: SystemAppearanceColorChannel,
  b: SystemAppearanceColorChannel,
  a: SystemAppearanceColorChannel
}) {}

export class SystemAppearanceResult extends Schema.Class<SystemAppearanceResult>(
  "SystemAppearanceResult"
)({
  appearance: SystemAppearanceMode
}) {}

export class SystemAppearanceAccentColorResult extends Schema.Class<SystemAppearanceAccentColorResult>(
  "SystemAppearanceAccentColorResult"
)({
  color: Schema.NullOr(SystemAppearanceColor)
}) {}

export class SystemAppearanceBooleanResult extends Schema.Class<SystemAppearanceBooleanResult>(
  "SystemAppearanceBooleanResult"
)({
  enabled: Schema.Boolean
}) {}

export class SystemAppearanceChangedEvent extends Schema.Class<SystemAppearanceChangedEvent>(
  "SystemAppearanceChangedEvent"
)({
  appearance: SystemAppearanceMode,
  accentColor: Schema.NullOr(SystemAppearanceColor),
  reducedMotion: Schema.Boolean,
  reducedTransparency: Schema.Boolean
}) {}

export class SystemAppearanceIsSupportedInput extends Schema.Class<SystemAppearanceIsSupportedInput>(
  "SystemAppearanceIsSupportedInput"
)({
  method: SystemAppearanceMethod
}) {}

export class SystemAppearanceSupportedResult extends Schema.Class<SystemAppearanceSupportedResult>(
  "SystemAppearanceSupportedResult"
)({
  supported: Schema.Boolean
}) {}
