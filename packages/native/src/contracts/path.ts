import { Schema } from "effect"

export class CanonicalPath extends Schema.Class<CanonicalPath>("CanonicalPath")({
  // eslint-disable-next-line no-control-regex -- Canonical paths must reject NUL.
  path: Schema.NonEmptyString.check(Schema.isPattern(/^[^\u0000]*$/))
}) {}
