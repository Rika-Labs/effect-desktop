import { Schema } from "effect"

// eslint-disable-next-line no-control-regex -- Updater versions must reject NUL.
const UpdaterVersion = Schema.NonEmptyString.check(Schema.isPattern(/^[^\u0000]*$/))

export class UpdaterCheckInput extends Schema.Class<UpdaterCheckInput>("UpdaterCheckInput")({
  currentVersion: Schema.optionalKey(UpdaterVersion)
}) {}

export class UpdaterDownloadInput extends Schema.Class<UpdaterDownloadInput>(
  "UpdaterDownloadInput"
)({
  version: Schema.optionalKey(UpdaterVersion)
}) {}

export class UpdaterInstallInput extends Schema.Class<UpdaterInstallInput>("UpdaterInstallInput")({
  version: Schema.optionalKey(UpdaterVersion)
}) {}

export class UpdaterCheckResult extends Schema.Class<UpdaterCheckResult>("UpdaterCheckResult")({
  available: Schema.Boolean,
  version: Schema.optionalKey(Schema.String),
  notes: Schema.optionalKey(Schema.String)
}) {}

export const UpdaterStatusState = Schema.Literals([
  "idle",
  "checking",
  "update-available",
  "downloading",
  "downloaded",
  "installing",
  "error"
])

export type UpdaterStatusState = Schema.Schema.Type<typeof UpdaterStatusState>

export class UpdaterStatusResult extends Schema.Class<UpdaterStatusResult>("UpdaterStatusResult")({
  state: UpdaterStatusState,
  version: Schema.optionalKey(Schema.String),
  progress: Schema.optionalKey(
    Schema.Number.check(
      Schema.isFinite(),
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(1)
    )
  ),
  message: Schema.optionalKey(Schema.String)
}) {}
