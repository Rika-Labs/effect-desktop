import { Schema } from "effect"

import { PrintableNonEmptyString } from "./strings.js"

export const NativeBridgePath = PrintableNonEmptyString.check(
  Schema.makeFilter(
    (value) => isSafeNativeBridgePath(value) || "must be an absolute path without dot segments"
  )
)

export class CanonicalPath extends Schema.Class<CanonicalPath>("CanonicalPath")({
  path: Schema.NonEmptyString.check(
    // eslint-disable-next-line no-control-regex -- Canonical paths must reject NUL.
    Schema.isPattern(/^[^\u0000]*$/),
    Schema.makeFilter((value) => isAbsolutePlatformPath(value) || "must be an absolute path")
  )
}) {}

const isAbsolutePlatformPath = (value: string): boolean =>
  value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")

const WindowsDriveAbsolutePathPattern = /^[A-Za-z]:[\\/]/u
const WindowsUncAbsolutePathPattern = /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u

const isSafeNativeBridgePath = (value: string): boolean => {
  if (value.startsWith("/")) {
    return !hasDotPathSegment(value, /\/+/u)
  }

  if (WindowsDriveAbsolutePathPattern.test(value) || WindowsUncAbsolutePathPattern.test(value)) {
    return !hasDotPathSegment(value, /[\\/]+/u)
  }

  return false
}

const hasDotPathSegment = (value: string, separator: RegExp): boolean =>
  value.split(separator).some((segment) => segment === "." || segment === "..")
