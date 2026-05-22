import { Schema } from "effect"
import { ImageMime } from "./image.js"
import { BridgeSafeString } from "./strings.js"

export const ClipboardImageMime = ImageMime

export type ClipboardImageMime = Schema.Schema.Type<typeof ClipboardImageMime>

export class ClipboardText extends Schema.Class<ClipboardText>("ClipboardText")({
  // eslint-disable-next-line no-control-regex -- Clipboard text must reject NUL.
  text: Schema.String.check(Schema.isPattern(/^[^\u0000]*$/))
}) {}

export class ClipboardHtml extends Schema.Class<ClipboardHtml>("ClipboardHtml")({
  // eslint-disable-next-line no-control-regex -- Clipboard HTML must reject NUL.
  html: Schema.String.check(Schema.isPattern(/^[^\u0000]*$/))
}) {}

export class ClipboardImage extends Schema.Class<ClipboardImage>("ClipboardImage")({
  mime: ClipboardImageMime,
  bytes: Schema.Uint8Array
}) {}

export type ClipboardImageOptions = Schema.Schema.Type<typeof ClipboardImage>

export const ClipboardCapability = Schema.Literals(["text", "html", "image", "clear", "selection"])

export type ClipboardCapability = Schema.Schema.Type<typeof ClipboardCapability>

export class ClipboardIsSupportedInput extends Schema.Class<ClipboardIsSupportedInput>(
  "ClipboardIsSupportedInput"
)({
  capability: ClipboardCapability
}) {}

export class ClipboardSupportedResult extends Schema.Class<ClipboardSupportedResult>(
  "ClipboardSupportedResult"
)(
  Schema.Struct({
    supported: Schema.Boolean,
    reason: Schema.optionalKey(BridgeSafeString)
  }).check(
    Schema.makeFilter<{
      readonly supported: boolean
      readonly reason?: string | undefined
    }>((value) =>
      value.supported
        ? value.reason === undefined || "supported Clipboard result must not include reason"
        : value.reason !== undefined || "unsupported Clipboard result requires reason"
    )
  )
) {}
