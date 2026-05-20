import { Schema } from "effect"

const NativeParityCapabilityKind = Schema.Literals(["none", "native"])

export type NativeParityCapabilityKind = Schema.Schema.Type<typeof NativeParityCapabilityKind>

export const NativeParitySupportStatus = Schema.Literals(["supported", "partial", "unsupported"])

export type NativeParitySupportStatus = Schema.Schema.Type<typeof NativeParitySupportStatus>

export const NativeParityPlatform = Schema.Literals(["macos", "windows", "linux"])

export type NativeParityPlatform = Schema.Schema.Type<typeof NativeParityPlatform>

export const NativeParityPlatformSupport = Schema.Union([
  Schema.Struct({
    platform: NativeParityPlatform,
    status: Schema.Literal("supported")
  }),
  Schema.Struct({
    platform: NativeParityPlatform,
    status: Schema.Literal("partial"),
    reason: Schema.NonEmptyString
  }),
  Schema.Struct({
    platform: NativeParityPlatform,
    status: Schema.Literal("unsupported"),
    reason: Schema.NonEmptyString
  })
])

export type NativeParityPlatformSupport = Schema.Schema.Type<typeof NativeParityPlatformSupport>

export const NativeParitySupport = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("supported"),
    platforms: Schema.optionalKey(Schema.Array(NativeParityPlatformSupport))
  }),
  Schema.Struct({
    status: Schema.Literal("partial"),
    reason: Schema.NonEmptyString,
    platforms: Schema.optionalKey(Schema.Array(NativeParityPlatformSupport))
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    reason: Schema.NonEmptyString,
    platforms: Schema.optionalKey(Schema.Array(NativeParityPlatformSupport))
  })
])

export type NativeParitySupport = Schema.Schema.Type<typeof NativeParitySupport>

export const NativeParityHostStatus = Schema.Literals(["routed", "missing", "capability-fact"])

export type NativeParityHostStatus = Schema.Schema.Type<typeof NativeParityHostStatus>

export const NativeParityReleaseStatus = Schema.Literals(["complete", "tracked", "untracked"])

export type NativeParityReleaseStatus = Schema.Schema.Type<typeof NativeParityReleaseStatus>

export const NativeParityReleaseDisposition = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("complete")
  }),
  Schema.Struct({
    status: Schema.Literal("tracked"),
    issue: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    url: Schema.NonEmptyString
  }),
  Schema.Struct({
    status: Schema.Literal("untracked"),
    reason: Schema.NonEmptyString
  })
])

export type NativeParityReleaseDisposition = Schema.Schema.Type<
  typeof NativeParityReleaseDisposition
>

const NativeParityCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export class NativeHostMethodInventorySnapshot extends Schema.Class<NativeHostMethodInventorySnapshot>(
  "NativeHostMethodInventorySnapshot"
)({
  methods: Schema.Array(Schema.NonEmptyString)
}) {}

export type NativeHostMethodInventorySnapshotType = Schema.Schema.Type<
  typeof NativeHostMethodInventorySnapshot
>

export class NativeParityMatrixRow extends Schema.Class<NativeParityMatrixRow>(
  "NativeParityMatrixRow"
)({
  tag: Schema.NonEmptyString,
  surface: Schema.NonEmptyString,
  method: Schema.NonEmptyString,
  capability: NativeParityCapabilityKind,
  support: NativeParitySupport,
  hostStatus: NativeParityHostStatus,
  release: NativeParityReleaseDisposition,
  hostMethod: Schema.optionalKey(Schema.NonEmptyString)
}) {}

export type NativeParityMatrixRowType = Schema.Schema.Type<typeof NativeParityMatrixRow>

export class NativeParityMatrixSummary extends Schema.Class<NativeParityMatrixSummary>(
  "NativeParityMatrixSummary"
)({
  total: NativeParityCount,
  routed: NativeParityCount,
  missing: NativeParityCount,
  supported: NativeParityCount,
  partial: NativeParityCount,
  unsupported: NativeParityCount,
  releaseComplete: NativeParityCount,
  releaseTracked: NativeParityCount,
  releaseUntracked: NativeParityCount
}) {}

export type NativeParityMatrixSummaryType = Schema.Schema.Type<typeof NativeParityMatrixSummary>

export class NativeParityMatrixResult extends Schema.Class<NativeParityMatrixResult>(
  "NativeParityMatrixResult"
)({
  rows: Schema.Array(NativeParityMatrixRow),
  summary: NativeParityMatrixSummary
}) {}

export type NativeParityMatrixResultType = Schema.Schema.Type<typeof NativeParityMatrixResult>

export const NativeParityMatrixErrorReason = Schema.Literals([
  "invalid-manifest",
  "invalid-host-inventory"
])

export type NativeParityMatrixErrorReason = Schema.Schema.Type<typeof NativeParityMatrixErrorReason>

export class NativeParityMatrixError extends Schema.TaggedErrorClass<NativeParityMatrixError>()(
  "NativeParityMatrixError",
  {
    reason: NativeParityMatrixErrorReason,
    tag: Schema.optionalKey(Schema.NonEmptyString),
    message: Schema.NonEmptyString
  }
) {}
