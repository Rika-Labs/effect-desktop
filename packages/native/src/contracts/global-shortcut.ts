import { Api } from "@effect-desktop/bridge"
import { Schema } from "effect"

const WindowResource = Api.Resource("window", "open")

export const GlobalShortcutSupportReason = Schema.Literals([
  "wayland-no-global-shortcut",
  "host-adapter-unimplemented"
])

export type GlobalShortcutSupportReason = Schema.Schema.Type<typeof GlobalShortcutSupportReason>

export class GlobalShortcutRegisterInput extends Schema.Class<GlobalShortcutRegisterInput>(
  "GlobalShortcutRegisterInput"
)({
  accelerator: Schema.String,
  registrarWindow: WindowResource.schema
}) {}

export class GlobalShortcutAcceleratorInput extends Schema.Class<GlobalShortcutAcceleratorInput>(
  "GlobalShortcutAcceleratorInput"
)({
  accelerator: Schema.String
}) {}

export class GlobalShortcutSupportedResult extends Schema.Class<GlobalShortcutSupportedResult>(
  "GlobalShortcutSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(GlobalShortcutSupportReason)
}) {}

export class GlobalShortcutRegisteredResult extends Schema.Class<GlobalShortcutRegisteredResult>(
  "GlobalShortcutRegisteredResult"
)({
  registered: Schema.Boolean
}) {}

export class GlobalShortcutPressedEvent extends Schema.Class<GlobalShortcutPressedEvent>(
  "GlobalShortcutPressedEvent"
)({
  accelerator: Schema.String,
  registrarWindowId: Schema.String
}) {}
