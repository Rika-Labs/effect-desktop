import { Schema } from "effect"

import { CanonicalPath } from "./path.js"
import { BridgeSafeNonEmptyString, PrintableNonEmptyString } from "./strings.js"

const AppVersion = Schema.NonEmptyString.check(
  Schema.isPattern(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
  )
)
// eslint-disable-next-line no-control-regex -- App launch args must reject NUL.
const ArgString = Schema.NonEmptyString.check(Schema.isPattern(/^[^\u0000]*$/))
const EnvironmentVariableName = PrintableNonEmptyString.check(Schema.isPattern(/^[^=]+$/u))

export const AppMetadataLaunchReason = Schema.Literals([
  "launch",
  "open-file",
  "open-url",
  "unknown"
])

export class AppMetadataInfo extends Schema.Class<AppMetadataInfo>("AppMetadataInfo")({
  id: PrintableNonEmptyString,
  name: PrintableNonEmptyString,
  version: AppVersion
}) {}

export class AppMetadataPaths extends Schema.Class<AppMetadataPaths>("AppMetadataPaths")({
  executable: CanonicalPath,
  resources: CanonicalPath,
  cwd: CanonicalPath
}) {}

export class AppMetadataEnvironmentShape extends Schema.Class<AppMetadataEnvironmentShape>(
  "AppMetadataEnvironmentShape"
)({
  variableNames: Schema.Array(EnvironmentVariableName)
}) {}

export class AppMetadataLaunchContext extends Schema.Class<AppMetadataLaunchContext>(
  "AppMetadataLaunchContext"
)({
  argv: Schema.Array(ArgString),
  cwd: CanonicalPath,
  reason: AppMetadataLaunchReason,
  environment: AppMetadataEnvironmentShape
}) {}

export const AppMetadataEventPhase = Schema.Literals([
  "info-read",
  "paths-read",
  "launch-context-read",
  "failed"
])

export class AppMetadataEvent extends Schema.Class<AppMetadataEvent>("AppMetadataEvent")({
  phase: AppMetadataEventPhase,
  reason: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}
