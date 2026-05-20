import { ResourceHandleSchema, type ResourceHandle } from "@orika/core"
import { Schema } from "effect"

import { PrintableNonEmptyString } from "./strings.js"

const WindowResource = ResourceHandleSchema("window", "open")
const MenuPlatform = Schema.Literals(["macos", "windows", "linux"])
const MenuCapabilityName = Schema.Literals(["application menu", "window menu", "command binding"])

const MenuItemBase = {
  id: PrintableNonEmptyString,
  label: PrintableNonEmptyString,
  commandId: Schema.optionalKey(PrintableNonEmptyString),
  enabled: Schema.optionalKey(Schema.Boolean),
  checked: Schema.optionalKey(Schema.Boolean),
  accelerator: Schema.optionalKey(PrintableNonEmptyString)
}

export type MenuPlatform = Schema.Schema.Type<typeof MenuPlatform>
export type MenuCapabilityName = Schema.Schema.Type<typeof MenuCapabilityName>
export type MenuWindowHandle = ResourceHandle<"window", "open">

export const MenuItem = Schema.Struct({
  type: Schema.Literal("item"),
  ...MenuItemBase
})

export type MenuItem = Schema.Schema.Type<typeof MenuItem>

export const MenuSeparator = Schema.Struct({
  type: Schema.Literal("separator"),
  id: Schema.optionalKey(PrintableNonEmptyString)
})

export type MenuSeparator = Schema.Schema.Type<typeof MenuSeparator>

export interface MenuSubmenuShape {
  readonly type: "submenu"
  readonly id: string
  readonly label: string
  readonly enabled?: boolean
  readonly items: ReadonlyArray<MenuTemplateEntry>
}

export type MenuTemplateEntry = MenuItem | MenuSeparator | MenuSubmenuShape

export const MenuSubmenu: Schema.Codec<MenuSubmenuShape> = Schema.Struct({
  type: Schema.Literal("submenu"),
  id: PrintableNonEmptyString,
  label: PrintableNonEmptyString,
  enabled: Schema.optionalKey(Schema.Boolean),
  items: Schema.Array(Schema.suspend((): Schema.Codec<MenuTemplateEntry> => MenuTemplateEntry))
})

export const MenuTemplateEntry: Schema.Codec<MenuTemplateEntry> = Schema.suspend(() =>
  Schema.Union([MenuItem, MenuSeparator, MenuSubmenu])
)

export class MenuTemplate extends Schema.Class<MenuTemplate>("MenuTemplate")({
  items: Schema.Array(MenuTemplateEntry)
}) {}

export type MenuTemplateOptions = Schema.Schema.Type<typeof MenuTemplate>

export class MenuSetApplicationMenuInput extends Schema.Class<MenuSetApplicationMenuInput>(
  "MenuSetApplicationMenuInput"
)({
  template: MenuTemplate
}) {}

export class MenuSetWindowMenuInput extends Schema.Class<MenuSetWindowMenuInput>(
  "MenuSetWindowMenuInput"
)({
  window: WindowResource,
  template: MenuTemplate
}) {}

export class MenuClearInput extends Schema.Class<MenuClearInput>("MenuClearInput")({
  window: Schema.optionalKey(WindowResource)
}) {}

export type MenuClearOptions = Schema.Schema.Type<typeof MenuClearInput>

export class MenuBindCommandInput extends Schema.Class<MenuBindCommandInput>(
  "MenuBindCommandInput"
)({
  itemId: PrintableNonEmptyString,
  commandId: PrintableNonEmptyString
}) {}

export class MenuCapabilityInput extends Schema.Class<MenuCapabilityInput>("MenuCapabilityInput")({
  name: MenuCapabilityName,
  platform: Schema.optionalKey(MenuPlatform)
}) {}

export type MenuCapabilityOptions = Schema.Schema.Type<typeof MenuCapabilityInput>

export class MenuCapabilityResult extends Schema.Class<MenuCapabilityResult>(
  "MenuCapabilityResult"
)({
  supported: Schema.Boolean
}) {}

export class MenuActivatedEvent extends Schema.Class<MenuActivatedEvent>("MenuActivatedEvent")({
  itemId: PrintableNonEmptyString,
  commandId: PrintableNonEmptyString,
  windowId: Schema.optionalKey(PrintableNonEmptyString)
}) {}
