import { Schema } from "effect"
import { ImageMime } from "./image.js"

export const ClipboardImageMime = ImageMime

export type ClipboardImageMime = Schema.Schema.Type<typeof ClipboardImageMime>

export class ClipboardText extends Schema.Class<ClipboardText>("ClipboardText")({
  // eslint-disable-next-line no-control-regex -- Clipboard text must reject NUL.
  text: Schema.String.check(Schema.isPattern(/^[^\u0000]*$/))
}) {}

export class ClipboardImage extends Schema.Class<ClipboardImage>("ClipboardImage")({
  mime: ClipboardImageMime,
  bytes: Schema.Uint8Array
}) {}

export type ClipboardImageOptions = Schema.Schema.Type<typeof ClipboardImage>

export const ClipboardCapability = Schema.Literals(["text", "image"])

export type ClipboardCapability = Schema.Schema.Type<typeof ClipboardCapability>

export class ClipboardIsSupportedInput extends Schema.Class<ClipboardIsSupportedInput>(
  "ClipboardIsSupportedInput"
)({
  capability: ClipboardCapability
}) {}

export class ClipboardSupportedResult extends Schema.Class<ClipboardSupportedResult>(
  "ClipboardSupportedResult"
)({
  supported: Schema.Boolean
}) {}
