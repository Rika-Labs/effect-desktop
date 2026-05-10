import { Api, type ApiResourceHandle } from "@effect-desktop/bridge"
import { Schema } from "effect"

import { MenuTemplate } from "./menu.js"
import { BridgeSafeNonEmptyString, PrintableNonEmptyString } from "./strings.js"

export const TrayResource = Api.Resource("tray", "open")

export type TrayHandle = ApiResourceHandle<"tray", "open">

export const TrayIcon = BridgeSafeNonEmptyString.check(Schema.isPattern(/^(?!file:)/iu))

export const TrayTooltip = PrintableNonEmptyString

export class TrayCreateInput extends Schema.Class<TrayCreateInput>("TrayCreateInput")({
  icon: TrayIcon,
  tooltip: Schema.optionalKey(TrayTooltip),
  menu: Schema.optionalKey(MenuTemplate)
}) {}

export type TrayCreateOptions = Schema.Schema.Type<typeof TrayCreateInput>

export class TraySetIconInput extends Schema.Class<TraySetIconInput>("TraySetIconInput")({
  tray: TrayResource.schema,
  icon: TrayIcon
}) {}

export class TraySetTooltipInput extends Schema.Class<TraySetTooltipInput>("TraySetTooltipInput")({
  tray: TrayResource.schema,
  tooltip: TrayTooltip
}) {}

export class TraySetMenuInput extends Schema.Class<TraySetMenuInput>("TraySetMenuInput")({
  tray: TrayResource.schema,
  menu: MenuTemplate
}) {}

export class TrayDestroyInput extends Schema.Class<TrayDestroyInput>("TrayDestroyInput")({
  tray: TrayResource.schema
}) {}

export class TrayActivatedEvent extends Schema.Class<TrayActivatedEvent>("TrayActivatedEvent")({
  tray: TrayResource.schema,
  ownerWindowId: Schema.optionalKey(Schema.NonEmptyString)
}) {}

export class TraySupportedResult extends Schema.Class<TraySupportedResult>("TraySupportedResult")({
  supported: Schema.Boolean
}) {}
