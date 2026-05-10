import { Schema } from "effect"
import { BridgeSafeNonEmptyString, PrintableNonEmptyString } from "./strings.js"

export const DialogLevel = Schema.Literals(["info", "warning", "error"])

export type DialogLevel = Schema.Schema.Type<typeof DialogLevel>

const DialogFileFilterName = PrintableNonEmptyString
const DialogFileFilterExtension = Schema.NonEmptyString.check(
  Schema.isPattern(/^(?!\*)[^\u0000-\u001f\u007f]+$/)
)

export class DialogFileFilter extends Schema.Class<DialogFileFilter>("DialogFileFilter")({
  name: DialogFileFilterName,
  extensions: Schema.Array(DialogFileFilterExtension)
}) {}

export type DialogFileFilterOptions = Schema.Schema.Type<typeof DialogFileFilter>

// eslint-disable-next-line no-control-regex -- Dialog default paths must reject NUL.
const DialogDefaultPath = Schema.String.check(Schema.isPattern(/^[^\u0000]*$/))
// eslint-disable-next-line no-control-regex -- Native dialog UI text must reject ASCII control bytes.
const DialogDisplayText = Schema.NonEmptyString.check(Schema.isPattern(/^[^\u0000-\u001f\u007f]*$/))

export class DialogOpenFileInput extends Schema.Class<DialogOpenFileInput>("DialogOpenFileInput")({
  title: Schema.optionalKey(DialogDisplayText),
  defaultPath: Schema.optionalKey(DialogDefaultPath),
  filters: Schema.optionalKey(Schema.Array(DialogFileFilter)),
  multiple: Schema.optionalKey(Schema.Boolean)
}) {}

export type DialogOpenFileOptions = Schema.Schema.Type<typeof DialogOpenFileInput>

export class DialogOpenDirectoryInput extends Schema.Class<DialogOpenDirectoryInput>(
  "DialogOpenDirectoryInput"
)({
  title: Schema.optionalKey(DialogDisplayText),
  defaultPath: Schema.optionalKey(DialogDefaultPath),
  multiple: Schema.optionalKey(Schema.Boolean)
}) {}

export type DialogOpenDirectoryOptions = Schema.Schema.Type<typeof DialogOpenDirectoryInput>

export class DialogSaveFileInput extends Schema.Class<DialogSaveFileInput>("DialogSaveFileInput")({
  title: Schema.optionalKey(DialogDisplayText),
  defaultPath: Schema.optionalKey(DialogDefaultPath),
  filters: Schema.optionalKey(Schema.Array(DialogFileFilter))
}) {}

export type DialogSaveFileOptions = Schema.Schema.Type<typeof DialogSaveFileInput>

export class DialogMessageInput extends Schema.Class<DialogMessageInput>("DialogMessageInput")({
  level: DialogLevel,
  title: Schema.optionalKey(DialogDisplayText),
  message: DialogDisplayText,
  detail: Schema.optionalKey(DialogDisplayText)
}) {}

export type DialogMessageOptions = Schema.Schema.Type<typeof DialogMessageInput>

export class DialogConfirmInput extends Schema.Class<DialogConfirmInput>("DialogConfirmInput")({
  title: Schema.optionalKey(DialogDisplayText),
  message: DialogDisplayText,
  detail: Schema.optionalKey(DialogDisplayText),
  confirmLabel: Schema.optionalKey(DialogDisplayText),
  cancelLabel: Schema.optionalKey(DialogDisplayText)
}) {}

export type DialogConfirmOptions = Schema.Schema.Type<typeof DialogConfirmInput>

export class DialogOpenResult extends Schema.Class<DialogOpenResult>("DialogOpenResult")({
  paths: Schema.Array(BridgeSafeNonEmptyString)
}) {}

export class DialogSaveResult extends Schema.Class<DialogSaveResult>("DialogSaveResult")({
  path: BridgeSafeNonEmptyString
}) {}

export class DialogConfirmResult extends Schema.Class<DialogConfirmResult>("DialogConfirmResult")({
  confirmed: Schema.Boolean
}) {}
