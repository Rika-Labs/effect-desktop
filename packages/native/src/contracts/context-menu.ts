import { Api } from "@effect-desktop/bridge"
import { Schema } from "effect"

import { MenuTemplate } from "../menu.js"

const WindowResource = Api.Resource("window", "open")

export class ContextMenuPosition extends Schema.Class<ContextMenuPosition>("ContextMenuPosition")({
  x: Schema.Number,
  y: Schema.Number
}) {}

export class ContextMenuShowInput extends Schema.Class<ContextMenuShowInput>(
  "ContextMenuShowInput"
)({
  window: WindowResource.schema,
  template: MenuTemplate,
  position: ContextMenuPosition
}) {}

export type ContextMenuShowOptions = Schema.Schema.Type<typeof ContextMenuShowInput>

export class ContextMenuBuildFromTemplateInput extends Schema.Class<ContextMenuBuildFromTemplateInput>(
  "ContextMenuBuildFromTemplateInput"
)({
  template: MenuTemplate
}) {}

export type ContextMenuBuildFromTemplateOptions = Schema.Schema.Type<
  typeof ContextMenuBuildFromTemplateInput
>

export class ContextMenuBindCommandInput extends Schema.Class<ContextMenuBindCommandInput>(
  "ContextMenuBindCommandInput"
)({
  itemId: Schema.String,
  commandId: Schema.String
}) {}

export class ContextMenuActivatedEvent extends Schema.Class<ContextMenuActivatedEvent>(
  "ContextMenuActivatedEvent"
)({
  itemId: Schema.NonEmptyString,
  commandId: Schema.NonEmptyString,
  windowId: Schema.NonEmptyString
}) {}
