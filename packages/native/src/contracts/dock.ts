import { Schema } from "effect"

import { MenuTemplate } from "./menu.js"

export const DockMethod = Schema.Literals([
  "setBadgeCount",
  "setBadgeText",
  "setProgress",
  "setMenu",
  "setJumpList",
  "requestAttention"
])

export const DockProgressState = Schema.Literals(["normal", "indeterminate", "error", "paused"])

export type DockMethod = Schema.Schema.Type<typeof DockMethod>
export type DockProgressState = Schema.Schema.Type<typeof DockProgressState>

// eslint-disable-next-line no-control-regex -- Dock badge text must reject ASCII control bytes.
const DockBadgeText = Schema.String.check(Schema.isPattern(/^[^\u0000-\u001f\u007f]*$/))

export class DockSetBadgeCountInput extends Schema.Class<DockSetBadgeCountInput>(
  "DockSetBadgeCountInput"
)({
  count: Schema.Number
}) {}

export class DockSetBadgeTextInput extends Schema.Class<DockSetBadgeTextInput>(
  "DockSetBadgeTextInput"
)({
  text: Schema.NullOr(DockBadgeText)
}) {}

export class DockSetProgressOptions extends Schema.Class<DockSetProgressOptions>(
  "DockSetProgressOptions"
)({
  state: Schema.optionalKey(DockProgressState)
}) {}

export class DockSetProgressInput extends Schema.Class<DockSetProgressInput>(
  "DockSetProgressInput"
)({
  value: Schema.NullOr(Schema.Number),
  options: Schema.optionalKey(DockSetProgressOptions)
}) {}

export class DockSetMenuInput extends Schema.Class<DockSetMenuInput>("DockSetMenuInput")({
  menu: Schema.NullOr(MenuTemplate)
}) {}

export class DockJumpListItem extends Schema.Class<DockJumpListItem>("DockJumpListItem")({
  id: Schema.String,
  title: Schema.String,
  commandId: Schema.String
}) {}

export class DockSetJumpListInput extends Schema.Class<DockSetJumpListInput>(
  "DockSetJumpListInput"
)({
  items: Schema.Array(DockJumpListItem)
}) {}

export class DockRequestAttentionInput extends Schema.Class<DockRequestAttentionInput>(
  "DockRequestAttentionInput"
)({
  critical: Schema.optionalKey(Schema.Boolean)
}) {}

export class DockIsSupportedInput extends Schema.Class<DockIsSupportedInput>(
  "DockIsSupportedInput"
)({
  method: DockMethod
}) {}

export class DockSupportedResult extends Schema.Class<DockSupportedResult>("DockSupportedResult")({
  supported: Schema.Boolean
}) {}
