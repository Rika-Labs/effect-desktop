import { Schema } from "effect"

import { CanonicalPath } from "./path.js"
import { BridgeSafeNonEmptyString } from "./strings.js"

export class RecentDocumentsAddInput extends Schema.Class<RecentDocumentsAddInput>(
  "RecentDocumentsAddInput"
)({
  path: CanonicalPath
}) {}

export type RecentDocumentsAddOptions = Schema.Schema.Type<typeof RecentDocumentsAddInput>

export class RecentDocument extends Schema.Class<RecentDocument>("RecentDocument")({
  path: CanonicalPath
}) {}

export class RecentDocumentsListResult extends Schema.Class<RecentDocumentsListResult>(
  "RecentDocumentsListResult"
)({
  documents: Schema.Array(RecentDocument)
}) {}

export const RecentDocumentsEventPhase = Schema.Literals(["document-added", "cleared", "failed"])

export class RecentDocumentsEvent extends Schema.Class<RecentDocumentsEvent>(
  "RecentDocumentsEvent"
)({
  phase: RecentDocumentsEventPhase,
  path: Schema.optionalKey(CanonicalPath),
  reason: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}
