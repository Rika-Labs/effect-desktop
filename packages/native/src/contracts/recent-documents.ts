import { Schema } from "effect"

import { CanonicalPath } from "./path.js"
import { BridgeSafeNonEmptyString } from "./strings.js"

const RecentDocumentPath = CanonicalPath.check(
  Schema.makeFilter(
    (value) =>
      isSafeRecentDocumentPath(value.path) ||
      "must be an absolute path without control characters or dot segments"
  )
)

const WindowsDriveAbsolutePathPattern = /^[A-Za-z]:[\\/]/u
const WindowsUncAbsolutePathPattern = /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u
const ControlCharacterPattern = /\p{Cc}/u

const isSafeRecentDocumentPath = (value: string): boolean => {
  if (ControlCharacterPattern.test(value)) {
    return false
  }

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

export class RecentDocumentsAddInput extends Schema.Class<RecentDocumentsAddInput>(
  "RecentDocumentsAddInput"
)({
  path: RecentDocumentPath
}) {}

export type RecentDocumentsAddOptions = Schema.Schema.Type<typeof RecentDocumentsAddInput>

export class RecentDocument extends Schema.Class<RecentDocument>("RecentDocument")({
  path: RecentDocumentPath
}) {}

export class RecentDocumentsListResult extends Schema.Class<RecentDocumentsListResult>(
  "RecentDocumentsListResult"
)({
  documents: Schema.Array(RecentDocument)
}) {}

export const RecentDocumentsEventPhase = Schema.Literals(["document-added", "cleared", "failed"])
export type RecentDocumentsEventPhase = typeof RecentDocumentsEventPhase.Type

const RecentDocumentsEventPhasePayload = Schema.makeFilter<{
  readonly phase: RecentDocumentsEventPhase
  readonly path?: typeof RecentDocumentPath.Type | undefined
  readonly reason?: string | undefined
}>((value) => {
  switch (value.phase) {
    case "document-added":
      return (
        (value.path !== undefined && value.reason === undefined) ||
        "document-added recent documents events require path only"
      )
    case "cleared":
      return (
        (value.path === undefined && value.reason === undefined) ||
        "cleared recent documents events must not include path or reason"
      )
    case "failed":
      return (
        (value.path === undefined && value.reason !== undefined) ||
        "failed recent documents events require reason and no path"
      )
  }
})

export class RecentDocumentsEvent extends Schema.Class<RecentDocumentsEvent>(
  "RecentDocumentsEvent"
)(
  Schema.Struct({
    phase: RecentDocumentsEventPhase,
    path: Schema.optionalKey(RecentDocumentPath),
    reason: Schema.optionalKey(BridgeSafeNonEmptyString)
  }).check(RecentDocumentsEventPhasePayload)
) {}
