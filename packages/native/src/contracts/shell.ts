import { Schema } from "effect"

export class ShellOpenExternalInput extends Schema.Class<ShellOpenExternalInput>(
  "ShellOpenExternalInput"
)({
  url: Schema.String,
  allowedSchemes: Schema.optionalKey(Schema.Array(Schema.String))
}) {}

export type ShellOpenExternalOptions = Schema.Schema.Type<typeof ShellOpenExternalInput>

export class ShellShowItemInFolderInput extends Schema.Class<ShellShowItemInFolderInput>(
  "ShellShowItemInFolderInput"
)({
  path: Schema.String
}) {}

export class ShellOpenPathInput extends Schema.Class<ShellOpenPathInput>("ShellOpenPathInput")({
  path: Schema.String,
  allowExecutable: Schema.optionalKey(Schema.Boolean)
}) {}

export type ShellOpenPathOptions = Schema.Schema.Type<typeof ShellOpenPathInput>

export class ShellTrashItemInput extends Schema.Class<ShellTrashItemInput>("ShellTrashItemInput")({
  path: Schema.String
}) {}
