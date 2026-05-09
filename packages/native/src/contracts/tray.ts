import { Api, type ApiResourceHandle } from "@effect-desktop/bridge"
import { Schema } from "effect"

import { MenuTemplate } from "../menu.js"

export const TrayResource = Api.Resource("tray", "open")

export type TrayHandle = ApiResourceHandle<"tray", "open">

export class TrayCreateInput extends Schema.Class<TrayCreateInput>("TrayCreateInput")({
  icon: Schema.String,
  tooltip: Schema.optionalKey(Schema.String),
  menu: Schema.optionalKey(MenuTemplate)
}) {}

export type TrayCreateOptions = Schema.Schema.Type<typeof TrayCreateInput>

export class TraySetIconInput extends Schema.Class<TraySetIconInput>("TraySetIconInput")({
  tray: TrayResource.schema,
  icon: Schema.String
}) {}

export class TraySetTooltipInput extends Schema.Class<TraySetTooltipInput>("TraySetTooltipInput")({
  tray: TrayResource.schema,
  tooltip: Schema.String
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
