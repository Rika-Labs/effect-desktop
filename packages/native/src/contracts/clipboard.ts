import { Schema } from "effect"

export const ClipboardImageMime = Schema.Literals(["image/png", "image/jpeg"])

export type ClipboardImageMime = Schema.Schema.Type<typeof ClipboardImageMime>

export class ClipboardText extends Schema.Class<ClipboardText>("ClipboardText")({
  text: Schema.String
}) {}

export class ClipboardImage extends Schema.Class<ClipboardImage>("ClipboardImage")({
  mime: ClipboardImageMime,
  bytes: Schema.Uint8Array
}) {}

export type ClipboardImageOptions = Schema.Schema.Type<typeof ClipboardImage>
