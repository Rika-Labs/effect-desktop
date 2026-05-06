import { Schema } from "effect"

export class CanonicalPath extends Schema.Class<CanonicalPath>("CanonicalPath")({
  path: Schema.String
}) {}
