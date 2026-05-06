import { Schema } from "effect"

export const SystemAppearanceMode = Schema.Literals(["light", "dark", "highContrast"])

export type SystemAppearanceMode = Schema.Schema.Type<typeof SystemAppearanceMode>

export class SystemAppearanceColor extends Schema.Class<SystemAppearanceColor>(
  "SystemAppearanceColor"
)({
  r: Schema.Number,
  g: Schema.Number,
  b: Schema.Number,
  a: Schema.Number
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
  appearance: SystemAppearanceMode
}) {}
