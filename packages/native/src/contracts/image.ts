import { Schema } from "effect"

export const ImageMime = Schema.Literals(["image/png", "image/jpeg"])
export type ImageMime = Schema.Schema.Type<typeof ImageMime>

export const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
export const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff])

export const isSupportedImageHeader = (
  mime: ImageMime,
  bytes: Uint8Array
): boolean => {
  if (mime === "image/png") {
    return hasPrefix(bytes, PNG_HEADER)
  }
  return hasPrefix(bytes, JPEG_HEADER)
}

const hasPrefix = (bytes: Uint8Array, prefix: Uint8Array): boolean => {
  if (bytes.length < prefix.length) {
    return false
  }

  return prefix.every((byte, index) => bytes[index] === byte)
}
