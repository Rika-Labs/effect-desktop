import { Schema } from "effect"

const NonNegativeInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const PortableExitCode = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(255)
)
// eslint-disable-next-line no-control-regex -- App launch args must reject NUL.
const ArgString = Schema.String.check(Schema.isPattern(/^[^\u0000]*$/))

export class AppInfo extends Schema.Class<AppInfo>("AppInfo")({
  id: Schema.String,
  name: Schema.String,
  version: Schema.String
}) {}

export class AppCommandLine extends Schema.Class<AppCommandLine>("AppCommandLine")({
  argv: Schema.Array(Schema.String),
  cwd: Schema.String
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
  primaryPid: Schema.optionalKey(NonNegativeInteger)
}) {}

export class AppOpenAtLoginInput extends Schema.Class<AppOpenAtLoginInput>("AppOpenAtLoginInput")({
  enabled: Schema.Boolean,
  args: Schema.optionalKey(Schema.Array(ArgString))
}) {}

export type AppOpenAtLoginOptions = Schema.Schema.Type<typeof AppOpenAtLoginInput>

export class AppProtocolInput extends Schema.Class<AppProtocolInput>("AppProtocolInput")({
  scheme: Schema.String
}) {}

export type AppProtocolOptions = Schema.Schema.Type<typeof AppProtocolInput>

export class AppSecondInstanceEvent extends Schema.Class<AppSecondInstanceEvent>(
  "AppSecondInstanceEvent"
)({
  argv: Schema.Array(Schema.String),
  cwd: Schema.String,
  traceId: Schema.String
}) {}

export class AppOpenFileEvent extends Schema.Class<AppOpenFileEvent>("AppOpenFileEvent")({
  // eslint-disable-next-line no-control-regex
  path: Schema.NonEmptyString.check(Schema.isPattern(/^[^\x00]*$/))
}) {}

export class AppOpenUrlEvent extends Schema.Class<AppOpenUrlEvent>("AppOpenUrlEvent")({
  url: Schema.String
}) {}

export class AppBeforeQuitEvent extends Schema.Class<AppBeforeQuitEvent>("AppBeforeQuitEvent")({
  traceId: Schema.String
}) {}
