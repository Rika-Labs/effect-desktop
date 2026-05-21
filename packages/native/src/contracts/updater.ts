import { Schema } from "effect"
import { PrintableNonEmptyString } from "./strings.js"

const UpdaterVersion = PrintableNonEmptyString
const UpdaterSignedManifestJson = PrintableNonEmptyString
const UpdaterPublicKey = PrintableNonEmptyString

export class UpdaterTrustAnchor extends Schema.Class<UpdaterTrustAnchor>("UpdaterTrustAnchor")({
  keyVersion: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(4_294_967_295)
  ),
  publicKey: UpdaterPublicKey
}) {}

export class UpdaterCheckInput extends Schema.Class<UpdaterCheckInput>("UpdaterCheckInput")({
  currentVersion: Schema.optionalKey(UpdaterVersion),
  manifestJson: UpdaterSignedManifestJson,
  trustAnchors: Schema.Array(UpdaterTrustAnchor).check(Schema.isNonEmpty())
}) {}

export class UpdaterDownloadInput extends Schema.Class<UpdaterDownloadInput>(
  "UpdaterDownloadInput"
)({
  version: Schema.optionalKey(UpdaterVersion)
}) {}

export class UpdaterInstallInput extends Schema.Class<UpdaterInstallInput>("UpdaterInstallInput")({
  version: Schema.optionalKey(UpdaterVersion)
}) {}

const UpdaterCheckUnavailableResult = Schema.Struct({
  available: Schema.Literal(false),
  version: Schema.optionalKey(UpdaterVersion),
  notes: Schema.optionalKey(Schema.String)
})

const UpdaterCheckAvailableResult = Schema.Struct({
  available: Schema.Literal(true),
  version: UpdaterVersion,
  notes: Schema.optionalKey(Schema.String)
})

export const UpdaterCheckResult = Schema.Union([
  UpdaterCheckUnavailableResult,
  UpdaterCheckAvailableResult
])

export type UpdaterCheckResult = Schema.Schema.Type<typeof UpdaterCheckResult>

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

const UpdaterStatusProgress = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1)
)

const UpdaterStatusWithoutUpdateVersion = Schema.Struct({
  state: Schema.Literals(["idle", "checking", "error"]),
  version: Schema.optionalKey(UpdaterVersion),
  progress: Schema.optionalKey(UpdaterStatusProgress),
  message: Schema.optionalKey(Schema.String)
})

const UpdaterStatusWithUpdateVersion = Schema.Struct({
  state: Schema.Literals(["update-available", "downloading", "downloaded", "installing"]),
  version: UpdaterVersion,
  progress: Schema.optionalKey(UpdaterStatusProgress),
  message: Schema.optionalKey(Schema.String)
})

export const UpdaterStatusResult = Schema.Union([
  UpdaterStatusWithoutUpdateVersion,
  UpdaterStatusWithUpdateVersion
])

export type UpdaterStatusResult = Schema.Schema.Type<typeof UpdaterStatusResult>

export class UpdaterPreparingRestartEvent extends Schema.Class<UpdaterPreparingRestartEvent>(
  "UpdaterPreparingRestartEvent"
)({
  deadlineMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
}) {}
