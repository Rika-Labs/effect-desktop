import { ResourceHandleSchema, type ResourceHandle } from "@effect-desktop/core"
import { Schema } from "effect"

import { MenuTemplate } from "./menu.js"
import { BridgeSafeNonEmptyString, PrintableNonEmptyString } from "./strings.js"

export const TrayResource = ResourceHandleSchema("tray", "open")

export type TrayHandle = ResourceHandle<"tray", "open">

export const TrayIcon = BridgeSafeNonEmptyString.check(Schema.isPattern(/^solid:#[0-9a-f]{8}$/iu))

export const TrayTooltip = PrintableNonEmptyString
export const TrayTitle = PrintableNonEmptyString

export class TrayCreateInput extends Schema.Class<TrayCreateInput>("TrayCreateInput")({
  icon: TrayIcon,
  tooltip: Schema.optionalKey(TrayTooltip),
  title: Schema.optionalKey(TrayTitle),
  menu: Schema.optionalKey(MenuTemplate)
}) {}

export type TrayCreateOptions = Schema.Schema.Type<typeof TrayCreateInput>

export class TraySetIconInput extends Schema.Class<TraySetIconInput>("TraySetIconInput")({
  tray: TrayResource,
  icon: TrayIcon
}) {}

export class TraySetTooltipInput extends Schema.Class<TraySetTooltipInput>("TraySetTooltipInput")({
  tray: TrayResource,
  tooltip: TrayTooltip
}) {}

export class TraySetTitleInput extends Schema.Class<TraySetTitleInput>("TraySetTitleInput")({
  tray: TrayResource,
  title: TrayTitle
}) {}

export class TraySetMenuInput extends Schema.Class<TraySetMenuInput>("TraySetMenuInput")({
  tray: TrayResource,
  menu: MenuTemplate
}) {}

export class TrayDestroyInput extends Schema.Class<TrayDestroyInput>("TrayDestroyInput")({
  tray: TrayResource
}) {}

export class TrayActivatedEvent extends Schema.Class<TrayActivatedEvent>("TrayActivatedEvent")({
  tray: TrayResource,
  ownerWindowId: Schema.optionalKey(Schema.NonEmptyString)
}) {}

export class TraySupportedResult extends Schema.Class<TraySupportedResult>("TraySupportedResult")({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}
