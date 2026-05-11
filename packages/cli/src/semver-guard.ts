import { readdir, readFile } from "node:fs/promises"
import { isAbsolute, join, normalize, resolve } from "node:path"

import { Data, Effect } from "effect"

import {
  PublicApiSnapshotMismatchError,
  runPublicApiCheck,
  type PublicApiChange,
  type PublicApiSnapshotError,
  type PublicApiSnapshotReport
} from "./public-api-snapshot.js"

export interface SemverGuardOptions {
  readonly cwd: string
  readonly publicApiCheck?: (
    cwd: string,
    snapshotRoot: string
  ) => Effect.Effect<PublicApiSnapshotReport, PublicApiSnapshotError, never>
}

export type SemverReleaseKind = "patch" | "minor" | "major"
export type SemverChangeClassification = "additive" | "breaking"

export interface SemverPolicyManifest {
  readonly schemaVersion: 1
  readonly source: string
  readonly release: string
  readonly releaseKind: SemverReleaseKind
  readonly publicApiSnapshots: string
  readonly verificationMatrix: string
  readonly appendixCRows: readonly string[]
  readonly bridgeEnvelopePolicy: {
    readonly source: string
    readonly frozenBetweenMajors: boolean
    readonly allowedChange: string
  }
  readonly deprecationPolicy: {
    readonly minimumMinorReleases: number
    readonly requiresJSDocDeprecated: boolean
  }
}

export interface SemverGuardReport {
  readonly passed: boolean
  readonly release: string
  readonly releaseKind: SemverReleaseKind
  readonly apiChanges: readonly SemverApiChange[]
  readonly appendixCRows: readonly string[]
  readonly packageVersions: readonly SemverPackageVersion[]
}

export interface SemverApiChange {
  readonly packageName: string
  readonly symbol: string
  readonly kind: PublicApiChange["kind"]
  readonly classification: SemverChangeClassification
}

export interface SemverPackageVersion {
  readonly name: string
  readonly version: string
  readonly path: string
}

export class SemverGuardFileError extends Data.TaggedError("SemverGuardFileError")<{
  readonly operation: string
  readonly path: string
  readonly message: string
  readonly cause: unknown
}> {}

export class SemverGuardManifestError extends Data.TaggedError("SemverGuardManifestError")<{
  readonly message: string
}> {}

export class SemverGuardPolicyError extends Data.TaggedError("SemverGuardPolicyError")<{
  readonly message: string
  readonly report: SemverGuardReport
}> {}

export type SemverGuardError =
  | SemverGuardFileError
  | SemverGuardManifestError
  | SemverGuardPolicyError
  | PublicApiSnapshotError

interface VerificationMatrix {
  readonly rows?: Record<string, unknown>
}

const MANIFEST_PATH = "release/semver.json"
const SPEC_SOURCE = "docs/SPEC.md §25.6"
const BRIDGE_SOURCE = "docs/SPEC.md §9.3"
const BRIDGE_ALLOWED_CHANGE =
  "fields may be added with defaults; fields may not be removed or reordered"
const CANONICAL_RELEASE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u

export const runSemverGuard = (
  options: SemverGuardOptions
): Effect.Effect<SemverGuardReport, SemverGuardError, never> =>
  Effect.gen(function* () {
    const manifest = yield* readJson(join(options.cwd, MANIFEST_PATH)).pipe(
      Effect.flatMap(parseSemverPolicyManifest)
    )
    yield* validateManifest(manifest)
    yield* validateAppendixCRows(options.cwd, manifest)
    const packageVersions = yield* readPackageVersions(options.cwd)
    yield* validatePackageVersions(manifest, packageVersions)

    const apiReport = yield* readPublicApiReport(options, manifest.publicApiSnapshots)
    const apiChanges = apiReport.changes.map(classifyApiChange)
    const report: SemverGuardReport = {
      passed: apiChanges.every((change) => isAllowedChange(manifest.releaseKind, change)),
      release: manifest.release,
      releaseKind: manifest.releaseKind,
      apiChanges,
      appendixCRows: manifest.appendixCRows,
      packageVersions
    }

    if (!report.passed) {
      return yield* Effect.fail(
        new SemverGuardPolicyError({
          message: "semver guard found public API changes forbidden for the release kind",
          report
        })
      )
    }

    return report
  })

export const formatSemverGuardReport = (report: SemverGuardReport): string =>
  [
    "Effect Desktop semver",
    `status            ${report.passed ? "passed" : "failed"}`,
    `release           ${report.release}`,
    `kind              ${report.releaseKind}`,
    `packages          ${report.packageVersions.length}`,
    `api changes       ${report.apiChanges.length}`,
    `appendix C rows   ${report.appendixCRows.length}`,
    ...report.apiChanges.map(
      (change) =>
        `${change.classification.toUpperCase()} ${change.packageName} ${change.symbol} ${change.kind}`
    ),
    ""
  ].join("\n")

export const formatSemverGuardError = (
  error: SemverGuardError
): { readonly tag: string; readonly message: string; readonly report?: SemverGuardReport } => {
  if (error instanceof SemverGuardPolicyError) {
    return { tag: error._tag, message: error.message, report: error.report }
  }
  return { tag: error._tag, message: error.message }
}

const readPublicApiReport = (
  options: SemverGuardOptions,
  snapshotRoot: string
): Effect.Effect<PublicApiSnapshotReport, PublicApiSnapshotError, never> => {
  const check =
    options.publicApiCheck ?? ((cwd, root) => runPublicApiCheck({ cwd, snapshotRoot: root }))
  return check(options.cwd, snapshotRoot).pipe(
    Effect.catch((error) =>
      error instanceof PublicApiSnapshotMismatchError
        ? Effect.succeed(error.report)
        : Effect.fail(error)
    )
  )
}

const validateManifest = (
  manifest: SemverPolicyManifest
): Effect.Effect<void, SemverGuardManifestError, never> => {
  if (manifest.schemaVersion !== 1) {
    return Effect.fail(new SemverGuardManifestError({ message: "semver schemaVersion must be 1" }))
  }
  if (manifest.source !== SPEC_SOURCE) {
    return Effect.fail(
      new SemverGuardManifestError({ message: `semver source must be ${SPEC_SOURCE}` })
    )
  }
  if (!CANONICAL_RELEASE_PATTERN.test(manifest.release)) {
    return Effect.fail(new SemverGuardManifestError({ message: "semver release must be X.Y.Z" }))
  }
  const expectedReleaseKind = releaseKindForVersion(manifest.release)
  if (manifest.releaseKind !== expectedReleaseKind) {
    return Effect.fail(
      new SemverGuardManifestError({
        message: `semver releaseKind must be ${expectedReleaseKind} for ${manifest.release}`
      })
    )
  }
  if (manifest.bridgeEnvelopePolicy.source !== BRIDGE_SOURCE) {
    return Effect.fail(
      new SemverGuardManifestError({ message: `bridge envelope source must be ${BRIDGE_SOURCE}` })
    )
  }
  if (!manifest.bridgeEnvelopePolicy.frozenBetweenMajors) {
    return Effect.fail(
      new SemverGuardManifestError({
        message: "bridge envelope policy must freeze shapes between majors"
      })
    )
  }
  if (manifest.bridgeEnvelopePolicy.allowedChange !== BRIDGE_ALLOWED_CHANGE) {
    return Effect.fail(
      new SemverGuardManifestError({
        message: `bridge envelope allowedChange must be ${BRIDGE_ALLOWED_CHANGE}`
      })
    )
  }
  if (!manifest.deprecationPolicy.requiresJSDocDeprecated) {
    return Effect.fail(
      new SemverGuardManifestError({
        message: "deprecation policy must require @deprecated JSDoc"
      })
    )
  }
  return Effect.void
}

const validateAppendixCRows = (
  cwd: string,
  manifest: SemverPolicyManifest
): Effect.Effect<void, SemverGuardError, never> =>
  Effect.gen(function* () {
    if (manifest.appendixCRows.length === 0) {
      return yield* Effect.fail(
        new SemverGuardManifestError({
          message: "semver appendixCRows must contain at least one row"
        })
      )
    }
    const matrixPath = yield* resolveWorkspacePath(
      cwd,
      manifest.verificationMatrix,
      "verificationMatrix"
    )
    const matrix = yield* readJson<VerificationMatrix>(matrixPath)
    const rows = yield* decodeVerificationMatrixRows(matrix)
    const rowSet = new Set(rows)
    for (const row of manifest.appendixCRows) {
      if (!rowSet.has(row)) {
        return yield* Effect.fail(
          new SemverGuardManifestError({
            message: `semver Appendix C row ${row} is missing from verification matrix`
          })
        )
      }
    }
  })

const decodeVerificationMatrixRows = (
  matrix: VerificationMatrix
): Effect.Effect<readonly string[], SemverGuardManifestError, never> => {
  if (!isSemverRecord(matrix.rows) || Array.isArray(matrix.rows)) {
    return Effect.fail(
      new SemverGuardManifestError({
        message: "semver verificationMatrix rows must be a JSON object"
      })
    )
  }

  return Effect.succeed(Object.keys(matrix.rows))
}

const validatePackageVersions = (
  manifest: SemverPolicyManifest,
  packageVersions: readonly SemverPackageVersion[]
): Effect.Effect<void, SemverGuardManifestError, never> => {
  const mismatches = packageVersions.filter((pkg) => pkg.version !== manifest.release)
  if (mismatches.length === 0) {
    return Effect.void
  }
  return Effect.fail(
    new SemverGuardManifestError({
      message: `semver release ${manifest.release} does not match package versions: ${mismatches
        .map((pkg) => `${pkg.name}@${pkg.version}`)
        .join(", ")}`
    })
  )
}

const readPackageVersions = (
  cwd: string
): Effect.Effect<readonly SemverPackageVersion[], SemverGuardError, never> =>
  Effect.gen(function* () {
    const packageRoot = join(cwd, "packages")
    const entries = yield* readDirectory(packageRoot)
    const versions: SemverPackageVersion[] = []
    for (const entry of entries.toSorted()) {
      const path = `packages/${entry}/package.json`
      const manifest = yield* readJson<unknown>(join(cwd, path)).pipe(
        Effect.flatMap((value) => parsePackageManifest(value, path))
      )
      versions.push(manifest)
    }
    return versions
  })

const parsePackageManifest = (
  value: unknown,
  path: string
): Effect.Effect<SemverPackageVersion, SemverGuardManifestError, never> => {
  if (!isSemverRecord(value)) {
    return Effect.fail(new SemverGuardManifestError({ message: `${path} must be a JSON object` }))
  }
  if (typeof value["name"] !== "string" || value["name"].length === 0) {
    return Effect.fail(
      new SemverGuardManifestError({ message: `${path} must declare a package name` })
    )
  }
  if (typeof value["version"] !== "string" || !/^\d+\.\d+\.\d+$/.test(value["version"])) {
    return Effect.fail(
      new SemverGuardManifestError({ message: `${path} must declare a semantic version` })
    )
  }
  return Effect.succeed({
    name: value["name"],
    version: value["version"],
    path
  })
}

const classifyApiChange = (change: PublicApiChange): SemverApiChange => ({
  packageName: change.packageName,
  symbol: change.symbol,
  kind: change.kind,
  classification: change.kind === "added" ? "additive" : "breaking"
})

const isAllowedChange = (releaseKind: SemverReleaseKind, change: SemverApiChange): boolean => {
  if (releaseKind === "major") {
    return true
  }
  if (releaseKind === "minor") {
    return change.classification === "additive"
  }
  return false
}

const releaseKindForVersion = (release: string): SemverReleaseKind => {
  const [, minor, patch] = release.split(".").map(Number)
  if (minor === 0 && patch === 0) {
    return "major"
  }
  if (patch === 0) {
    return "minor"
  }
  return "patch"
}

const readJson = <A>(path: string): Effect.Effect<A, SemverGuardFileError, never> =>
  readText(path).pipe(
    Effect.flatMap((body) =>
      Effect.try({
        try: () => JSON.parse(body) as A,
        catch: (cause) =>
          new SemverGuardFileError({
            operation: "parse-json",
            path,
            message: `failed to parse JSON at ${path}`,
            cause
          })
      })
    )
  )

const parseSemverPolicyManifest = (
  value: unknown
): Effect.Effect<SemverPolicyManifest, SemverGuardManifestError, never> => {
  if (!isSemverRecord(value)) {
    return Effect.fail(
      new SemverGuardManifestError({ message: "semver manifest must be a JSON object" })
    )
  }
  const schemaVersion = value["schemaVersion"]
  if (typeof schemaVersion !== "number") {
    return Effect.fail(
      new SemverGuardManifestError({ message: "semver schemaVersion must be a number" })
    )
  }
  if (schemaVersion !== 1) {
    return Effect.fail(new SemverGuardManifestError({ message: "semver schemaVersion must be 1" }))
  }
  if (typeof value["source"] !== "string") {
    return Effect.fail(new SemverGuardManifestError({ message: "semver source must be a string" }))
  }
  if (typeof value["release"] !== "string") {
    return Effect.fail(
      new SemverGuardManifestError({ message: "semver release must be a semantic version string" })
    )
  }
  if (!isSemverReleaseKind(value["releaseKind"])) {
    return Effect.fail(
      new SemverGuardManifestError({ message: "semver releaseKind must be patch, minor, or major" })
    )
  }
  if (typeof value["publicApiSnapshots"] !== "string") {
    return Effect.fail(
      new SemverGuardManifestError({ message: "semver publicApiSnapshots must be a string" })
    )
  }
  if (!isWorkspaceRelativePath(value["publicApiSnapshots"])) {
    return Effect.fail(
      new SemverGuardManifestError({
        message: "semver publicApiSnapshots must be a workspace-contained relative path"
      })
    )
  }
  if (typeof value["verificationMatrix"] !== "string") {
    return Effect.fail(
      new SemverGuardManifestError({ message: "semver verificationMatrix must be a string" })
    )
  }
  if (!isWorkspaceRelativePath(value["verificationMatrix"])) {
    return Effect.fail(
      new SemverGuardManifestError({
        message: "semver verificationMatrix must be a workspace-contained relative path"
      })
    )
  }
  if (
    !Array.isArray(value["appendixCRows"]) ||
    !value["appendixCRows"].every((row) => typeof row === "string" && row.length > 0)
  ) {
    return Effect.fail(
      new SemverGuardManifestError({
        message: "semver appendixCRows must be an array of non-empty strings"
      })
    )
  }
  const bridge = value["bridgeEnvelopePolicy"]
  if (!isSemverRecord(bridge)) {
    return Effect.fail(
      new SemverGuardManifestError({ message: "semver bridgeEnvelopePolicy must be an object" })
    )
  }
  if (typeof bridge["source"] !== "string") {
    return Effect.fail(
      new SemverGuardManifestError({
        message: "semver bridgeEnvelopePolicy.source must be a string"
      })
    )
  }
  if (typeof bridge["frozenBetweenMajors"] !== "boolean") {
    return Effect.fail(
      new SemverGuardManifestError({
        message: "semver bridgeEnvelopePolicy.frozenBetweenMajors must be a boolean"
      })
    )
  }
  if (typeof bridge["allowedChange"] !== "string") {
    return Effect.fail(
      new SemverGuardManifestError({
        message: "semver bridgeEnvelopePolicy.allowedChange must be a string"
      })
    )
  }
  const deprecation = value["deprecationPolicy"]
  if (!isSemverRecord(deprecation)) {
    return Effect.fail(
      new SemverGuardManifestError({ message: "semver deprecationPolicy must be an object" })
    )
  }
  if (
    typeof deprecation["minimumMinorReleases"] !== "number" ||
    !Number.isInteger(deprecation["minimumMinorReleases"]) ||
    deprecation["minimumMinorReleases"] < 0
  ) {
    return Effect.fail(
      new SemverGuardManifestError({
        message: "semver deprecationPolicy.minimumMinorReleases must be a non-negative integer"
      })
    )
  }
  if (typeof deprecation["requiresJSDocDeprecated"] !== "boolean") {
    return Effect.fail(
      new SemverGuardManifestError({
        message: "semver deprecationPolicy.requiresJSDocDeprecated must be a boolean"
      })
    )
  }
  return Effect.succeed({
    schemaVersion: 1,
    source: value["source"],
    release: value["release"],
    releaseKind: value["releaseKind"],
    publicApiSnapshots: value["publicApiSnapshots"],
    verificationMatrix: value["verificationMatrix"],
    appendixCRows: value["appendixCRows"],
    bridgeEnvelopePolicy: {
      source: bridge["source"],
      frozenBetweenMajors: bridge["frozenBetweenMajors"],
      allowedChange: bridge["allowedChange"]
    },
    deprecationPolicy: {
      minimumMinorReleases: deprecation["minimumMinorReleases"],
      requiresJSDocDeprecated: deprecation["requiresJSDocDeprecated"]
    }
  })
}

const isSemverRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isSemverReleaseKind = (value: unknown): value is SemverReleaseKind =>
  value === "patch" || value === "minor" || value === "major"

const isWorkspaceRelativePath = (value: string): boolean => {
  const normalized = normalize(value)
  return (
    value.length > 0 &&
    !isAbsolute(value) &&
    normalized !== ".." &&
    !normalized.startsWith(`..${"/"}`) &&
    !normalized.startsWith(`..${"\\"}`)
  )
}

const resolveWorkspacePath = (
  cwd: string,
  path: string,
  field: string
): Effect.Effect<string, SemverGuardManifestError, never> => {
  const root = resolve(cwd)
  const resolved = resolve(root, path)
  const relativePath = normalize(resolved.slice(root.length))

  return resolved === root ||
    relativePath.startsWith(`${"/"}`) ||
    relativePath.startsWith(`${"\\"}`)
    ? Effect.succeed(resolved)
    : Effect.fail(
        new SemverGuardManifestError({
          message: `semver ${field} must resolve inside the workspace`
        })
      )
}

const readText = (path: string): Effect.Effect<string, SemverGuardFileError, never> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) =>
      new SemverGuardFileError({
        operation: "read",
        path,
        message: `failed to read ${path}`,
        cause
      })
  })

const readDirectory = (
  path: string
): Effect.Effect<readonly string[], SemverGuardFileError, never> =>
  Effect.tryPromise({
    try: () => readdir(path),
    catch: (cause) =>
      new SemverGuardFileError({
        operation: "readdir",
        path,
        message: `failed to read directory ${path}`,
        cause
      })
  })
