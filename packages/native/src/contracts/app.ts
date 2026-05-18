import { Schema } from "effect"
import { BridgeSafeNonEmptyString, PrintableNonEmptyString } from "./strings.js"

const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0))
const PortableExitCode = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(255)
)
// eslint-disable-next-line no-control-regex -- App launch args must reject NUL.
const ArgString = Schema.NonEmptyString.check(Schema.isPattern(/^[^\u0000]*$/))
const DangerousOpenIntentSchemes = new Set([
  "about:",
  "blob:",
  "data:",
  "file:",
  "javascript:",
  "vbscript:",
  "view-source:"
])
const isAppUrl = (value: string): boolean => {
  if (value.length === 0) {
    return false
  }

  if (value.includes("\u0000")) {
    return false
  }

  try {
    const url = new URL(value)
    return !DangerousOpenIntentSchemes.has(url.protocol.toLowerCase())
  } catch {
    return false
  }
}

const AppUrl = PrintableNonEmptyString.check(
  Schema.makeFilter((value) => isAppUrl(value) || "must be a valid URL")
)
const AppOpenFilePath = PrintableNonEmptyString.check(
  Schema.makeFilter(
    (value) => isSafeAbsolutePlatformPath(value) || "must be an absolute path without dot segments"
  )
)

const WindowsDriveAbsolutePathPattern = /^[A-Za-z]:[\\/]/u
const WindowsUncAbsolutePathPattern = /^\\\\[^\\/]+\\[^\\/]+(?:[\\/]|$)/u

const isSafeAbsolutePlatformPath = (value: string): boolean => {
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

export class AppQuitInput extends Schema.Class<AppQuitInput>("AppQuitInput")({
  exitCode: Schema.optionalKey(PortableExitCode)
}) {}

export type AppQuitOptions = Schema.Schema.Type<typeof AppQuitInput>

export class AppRestartInput extends Schema.Class<AppRestartInput>("AppRestartInput")({
  args: Schema.optionalKey(Schema.Array(ArgString))
}) {}

export type AppRestartOptions = Schema.Schema.Type<typeof AppRestartInput>

export class AppSingleInstanceResult extends Schema.Class<AppSingleInstanceResult>(
  "AppSingleInstanceResult"
)({
  acquired: Schema.Boolean,
  primaryPid: Schema.optionalKey(PositiveInteger)
}) {}

export const AppSingleInstanceOutput = AppSingleInstanceResult.check(
  Schema.makeFilter<AppSingleInstanceResult>((value) =>
    value.acquired && value.primaryPid !== undefined
      ? "primaryPid must be absent when acquired is true"
      : true
  )
)

export const AppActivationReason = Schema.Literals(["launch", "open-file", "open-url", "unknown"])

export class AppSecondInstanceEvent extends Schema.Class<AppSecondInstanceEvent>(
  "AppSecondInstanceEvent"
)({
  argv: Schema.Array(ArgString),
  cwd: BridgeSafeNonEmptyString,
  activationReason: AppActivationReason,
  traceId: PrintableNonEmptyString
}) {}

export class AppOpenFileEvent extends Schema.Class<AppOpenFileEvent>("AppOpenFileEvent")({
  path: AppOpenFilePath
}) {}

export class AppOpenUrlEvent extends Schema.Class<AppOpenUrlEvent>("AppOpenUrlEvent")({
  url: AppUrl
}) {}

export class AppBeforeQuitEvent extends Schema.Class<AppBeforeQuitEvent>("AppBeforeQuitEvent")({
  traceId: PrintableNonEmptyString
}) {}
