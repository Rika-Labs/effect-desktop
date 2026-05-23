import { basename, isAbsolute, resolve, sep } from "node:path"

import { Data, Effect, Schema } from "effect"

import { DesktopArtifactKind, DesktopTargetId } from "./targets.js"

const StrictParseOptions = { errors: "all", onExcessProperty: "error" } as const
const Sha256DigestPattern = /^[a-f0-9]{64}$/u

const PackageArtifactSizeBytes = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const PackageArtifactSha256 = Schema.String.check(Schema.isPattern(Sha256DigestPattern))

const PackageArtifactLinuxIntegration = Schema.Struct({
  desktopFile: Schema.String,
  appStreamId: Schema.String,
  flatpakAppId: Schema.String,
  snapName: Schema.String
})

export const PackageArtifactMetadata = Schema.Struct({
  appId: Schema.String,
  appName: Schema.String,
  appVersion: Schema.String,
  kind: DesktopArtifactKind,
  target: DesktopTargetId,
  fileName: Schema.String,
  sizeBytes: Schema.Number,
  sha256: Schema.String,
  linuxIntegration: Schema.optionalKey(PackageArtifactLinuxIntegration)
})

export type PackageArtifactMetadata = Schema.Schema.Type<typeof PackageArtifactMetadata>

export interface PackageArtifactDigest {
  readonly sizeBytes: number
  readonly sha256: string
}

export class PackageArtifactMetadataFieldError extends Data.TaggedError(
  "PackageArtifactMetadataFieldError"
)<{
  readonly field: string
  readonly message: string
}> {}

export const decodePackageArtifactMetadataJson = (
  content: string
): Effect.Effect<PackageArtifactMetadata, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(PackageArtifactMetadata))(
    content,
    StrictParseOptions
  )

export const decodePackageArtifactSizeBytes = (
  value: unknown,
  field: string
): Effect.Effect<number, PackageArtifactMetadataFieldError, never> =>
  Schema.decodeUnknownEffect(PackageArtifactSizeBytes)(value).pipe(
    Effect.mapError(
      () =>
        new PackageArtifactMetadataFieldError({
          field,
          message: `${field} must be a non-negative integer`
        })
    )
  )

export const decodePackageArtifactSha256 = (
  value: unknown,
  field: string
): Effect.Effect<string, PackageArtifactMetadataFieldError, never> =>
  Schema.decodeUnknownEffect(PackageArtifactSha256)(value).pipe(
    Effect.mapError(
      () =>
        new PackageArtifactMetadataFieldError({
          field,
          message: `${field} must be a lowercase SHA-256 hex digest`
        })
    )
  )

export const resolveContainedPackageArtifactPath = (
  rootPath: string,
  fileName: unknown,
  field: string
): Effect.Effect<string, PackageArtifactMetadataFieldError, never> =>
  Effect.gen(function* () {
    const containedFileName = yield* decodeContainedPackageArtifactFileName(fileName, field)
    const resolvedRoot = resolve(rootPath)
    const candidate = resolve(resolvedRoot, containedFileName)
    const containedPrefix = `${resolvedRoot}${sep}`
    if (candidate !== resolvedRoot && !candidate.startsWith(containedPrefix)) {
      return yield* Effect.fail(
        new PackageArtifactMetadataFieldError({
          field,
          message: `${field} resolves outside the artifact metadata directory`
        })
      )
    }
    return candidate
  })

export const packageArtifactDigestMatches = (
  expected: PackageArtifactDigest,
  actual: PackageArtifactDigest
): boolean => expected.sizeBytes === actual.sizeBytes && expected.sha256 === actual.sha256

const decodeContainedPackageArtifactFileName = (
  value: unknown,
  field: string
): Effect.Effect<string, PackageArtifactMetadataFieldError, never> => {
  if (typeof value !== "string" || value.length === 0) {
    return Effect.fail(
      new PackageArtifactMetadataFieldError({
        field,
        message: `${field} is required`
      })
    )
  }
  if (!isContainedPackageArtifactFileName(value)) {
    return Effect.fail(
      new PackageArtifactMetadataFieldError({
        field,
        message: `${field} must be a single file name without path separators`
      })
    )
  }
  return Effect.succeed(value)
}

const isContainedPackageArtifactFileName = (value: string): boolean => {
  if (value === "." || value === "..") {
    return false
  }
  if (value.includes("/") || value.includes("\\") || value.includes(":")) {
    return false
  }
  if (isAbsolute(value)) {
    return false
  }
  if (basename(value) !== value) {
    return false
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) {
      return false
    }
  }
  return true
}
