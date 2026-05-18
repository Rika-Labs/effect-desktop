import { Schema } from "effect"
import { BridgeSafeNonEmptyString, PrintableNonEmptyString } from "./strings.js"
import { ProtocolScheme } from "./protocol.js"

const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0))
const PortableExitCode = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(255)
)
const AppVersion = Schema.NonEmptyString.check(
  Schema.isPattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u)
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

export class AppInfo extends Schema.Class<AppInfo>("AppInfo")({
  id: PrintableNonEmptyString,
  name: PrintableNonEmptyString,
  version: AppVersion
}) {}

export class AppCommandLine extends Schema.Class<AppCommandLine>("AppCommandLine")({
  argv: Schema.Array(ArgString),
  cwd: BridgeSafeNonEmptyString
}) {}

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

export class AppOpenAtLoginInput extends Schema.Class<AppOpenAtLoginInput>("AppOpenAtLoginInput")({
  enabled: Schema.Boolean,
  args: Schema.optionalKey(Schema.Array(ArgString))
}) {}

export type AppOpenAtLoginOptions = Schema.Schema.Type<typeof AppOpenAtLoginInput>

export class AppProtocolInput extends Schema.Class<AppProtocolInput>("AppProtocolInput")({
  scheme: ProtocolScheme
}) {}

export type AppProtocolOptions = Schema.Schema.Type<typeof AppProtocolInput>

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
  // eslint-disable-next-line no-control-regex
  path: Schema.NonEmptyString.check(Schema.isPattern(/^[^\x00]*$/))
}) {}

export class AppOpenUrlEvent extends Schema.Class<AppOpenUrlEvent>("AppOpenUrlEvent")({
  url: AppUrl
}) {}

export class AppBeforeQuitEvent extends Schema.Class<AppBeforeQuitEvent>("AppBeforeQuitEvent")({
  traceId: PrintableNonEmptyString
}) {}
