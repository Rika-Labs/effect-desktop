import { ResourceHandleSchema } from "@orika/core"
import { Schema } from "effect"

import { BridgeSafeNonEmptyString } from "./strings.js"

const WindowResource = ResourceHandleSchema("window", "open")

export const GlobalShortcutSupportReason = Schema.Literals([
  "wayland-no-global-shortcut",
  "host-adapter-unimplemented"
])

export type GlobalShortcutSupportReason = Schema.Schema.Type<typeof GlobalShortcutSupportReason>

export class GlobalShortcutRegisterInput extends Schema.Class<GlobalShortcutRegisterInput>(
  "GlobalShortcutRegisterInput"
)({
  accelerator: BridgeSafeNonEmptyString,
  registrarWindow: WindowResource
}) {}

export class GlobalShortcutAcceleratorInput extends Schema.Class<GlobalShortcutAcceleratorInput>(
  "GlobalShortcutAcceleratorInput"
)({
  accelerator: BridgeSafeNonEmptyString
}) {}

export class GlobalShortcutSupportedResult extends Schema.Class<GlobalShortcutSupportedResult>(
  "GlobalShortcutSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(GlobalShortcutSupportReason)
}) {}

export const GlobalShortcutSupportedOutput = GlobalShortcutSupportedResult.check(
  Schema.makeFilter<GlobalShortcutSupportedResult>((value) =>
    value.supported
      ? value.reason === undefined ||
        "supported result must not include reason when supported is true"
      : value.reason !== undefined || "supported result requires reason when supported is false"
  )
)

export class GlobalShortcutRegisteredResult extends Schema.Class<GlobalShortcutRegisteredResult>(
  "GlobalShortcutRegisteredResult"
)({
  registered: Schema.Boolean
}) {}

export class GlobalShortcutPressedEvent extends Schema.Class<GlobalShortcutPressedEvent>(
  "GlobalShortcutPressedEvent"
)({
  accelerator: BridgeSafeNonEmptyString,
  registrarWindowId: BridgeSafeNonEmptyString
}) {}
