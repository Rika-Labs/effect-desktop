import { Schema } from "effect"

export class CanonicalPath extends Schema.Class<CanonicalPath>("CanonicalPath")({
  // eslint-disable-next-line no-control-regex
  path: Schema.String.check(Schema.isPattern(/^[^\x00]*$/))
}) {}
