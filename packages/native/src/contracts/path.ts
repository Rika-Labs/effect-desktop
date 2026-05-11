import { Schema } from "effect"

export class CanonicalPath extends Schema.Class<CanonicalPath>("CanonicalPath")({
  path: Schema.NonEmptyString.check(
    // eslint-disable-next-line no-control-regex -- Canonical paths must reject NUL.
    Schema.isPattern(/^[^\u0000]*$/),
    Schema.makeFilter((value) => isAbsolutePlatformPath(value) || "must be an absolute path")
  )
}) {}

const isAbsolutePlatformPath = (value: string): boolean =>
  value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")
