import { Api } from "@effect-desktop/bridge"
import { Schema } from "effect"

import { MenuTemplate } from "./menu.js"
import { PrintableNonEmptyString } from "./strings.js"

const WindowResource = Api.Resource("window", "open")
const ContextMenuCoordinate = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)

export const ContextMenuIdentifier = PrintableNonEmptyString

export class ContextMenuPosition extends Schema.Class<ContextMenuPosition>("ContextMenuPosition")({
  x: ContextMenuCoordinate,
  y: ContextMenuCoordinate
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
  itemId: ContextMenuIdentifier,
  commandId: ContextMenuIdentifier
}) {}

export class ContextMenuActivatedEvent extends Schema.Class<ContextMenuActivatedEvent>(
  "ContextMenuActivatedEvent"
)({
  itemId: ContextMenuIdentifier,
  commandId: ContextMenuIdentifier,
  windowId: ContextMenuIdentifier
}) {}
