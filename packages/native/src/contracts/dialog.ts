import { Schema } from "effect"

export const DialogLevel = Schema.Literals(["info", "warning", "error"])

export type DialogLevel = Schema.Schema.Type<typeof DialogLevel>

export class DialogFileFilter extends Schema.Class<DialogFileFilter>("DialogFileFilter")({
  name: Schema.String,
  extensions: Schema.Array(Schema.String)
}) {}

export type DialogFileFilterOptions = Schema.Schema.Type<typeof DialogFileFilter>

export class DialogOpenFileInput extends Schema.Class<DialogOpenFileInput>("DialogOpenFileInput")({
  title: Schema.optionalKey(Schema.String),
  defaultPath: Schema.optionalKey(Schema.String),
  filters: Schema.optionalKey(Schema.Array(DialogFileFilter)),
  multiple: Schema.optionalKey(Schema.Boolean)
}) {}

export type DialogOpenFileOptions = Schema.Schema.Type<typeof DialogOpenFileInput>

export class DialogOpenDirectoryInput extends Schema.Class<DialogOpenDirectoryInput>(
  "DialogOpenDirectoryInput"
)({
  title: Schema.optionalKey(Schema.String),
  defaultPath: Schema.optionalKey(Schema.String),
  multiple: Schema.optionalKey(Schema.Boolean)
}) {}

export type DialogOpenDirectoryOptions = Schema.Schema.Type<typeof DialogOpenDirectoryInput>

export class DialogSaveFileInput extends Schema.Class<DialogSaveFileInput>("DialogSaveFileInput")({
  title: Schema.optionalKey(Schema.String),
  defaultPath: Schema.optionalKey(Schema.String),
  filters: Schema.optionalKey(Schema.Array(DialogFileFilter))
}) {}

export type DialogSaveFileOptions = Schema.Schema.Type<typeof DialogSaveFileInput>

export class DialogMessageInput extends Schema.Class<DialogMessageInput>("DialogMessageInput")({
  level: DialogLevel,
  title: Schema.optionalKey(Schema.String),
  message: Schema.NonEmptyString,
  detail: Schema.optionalKey(Schema.String)
}) {}

export type DialogMessageOptions = Schema.Schema.Type<typeof DialogMessageInput>

export class DialogConfirmInput extends Schema.Class<DialogConfirmInput>("DialogConfirmInput")({
  title: Schema.optionalKey(Schema.String),
  message: Schema.NonEmptyString,
  detail: Schema.optionalKey(Schema.String),
  confirmLabel: Schema.optionalKey(Schema.String),
  cancelLabel: Schema.optionalKey(Schema.String)
}) {}

export type DialogConfirmOptions = Schema.Schema.Type<typeof DialogConfirmInput>

export class DialogOpenResult extends Schema.Class<DialogOpenResult>("DialogOpenResult")({
  paths: Schema.Array(Schema.String)
}) {}

export class DialogSaveResult extends Schema.Class<DialogSaveResult>("DialogSaveResult")({
  path: Schema.String
}) {}

export class DialogConfirmResult extends Schema.Class<DialogConfirmResult>("DialogConfirmResult")({
  confirmed: Schema.Boolean
}) {}
