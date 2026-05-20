import { readdir, readFile, stat } from "node:fs/promises"
import { isAbsolute, join, normalize, resolve } from "node:path"

import { Data, Effect, Result, Schema } from "effect"

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

export const SemverReleaseKind = Schema.Literals(["patch", "minor", "major"])
export type SemverReleaseKind = typeof SemverReleaseKind.Type
export type SemverChangeClassification = "additive" | "breaking"

export class BridgeEnvelopePolicyManifest extends Schema.Class<BridgeEnvelopePolicyManifest>(
  "BridgeEnvelopePolicyManifest"
)({
  source: Schema.String,
  frozenBetweenMajors: Schema.Boolean,
  allowedChange: Schema.String
}) {}

export class DeprecationPolicyManifest extends Schema.Class<DeprecationPolicyManifest>(
  "DeprecationPolicyManifest"
)({
  minimumMinorReleases: Schema.Number,
  requiresJSDocDeprecated: Schema.Boolean
}) {}

export class SemverPolicyManifest extends Schema.Class<SemverPolicyManifest>(
  "SemverPolicyManifest"
)({
  schemaVersion: Schema.Literal(1),
  source: Schema.String,
  release: Schema.String,
  releaseKind: SemverReleaseKind,
  publicApiSnapshots: Schema.String,
  verificationMatrix: Schema.String,
  appendixCRows: Schema.Array(Schema.String),
  bridgeEnvelopePolicy: BridgeEnvelopePolicyManifest,
  deprecationPolicy: DeprecationPolicyManifest
}) {}

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

export class SemverPackageVersion extends Schema.Class<SemverPackageVersion>(
  "SemverPackageVersion"
)({
  name: Schema.String,
  version: Schema.String,
  path: Schema.String
}) {}

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

const VerificationMatrixCiCell = Schema.Struct({
  cell: Schema.String,
  runner: Schema.String,
  headless: Schema.Boolean
})

const VerificationMatrixManualGateCell = Schema.Struct({
  cell: Schema.String,
  reason: Schema.String,
  path: Schema.String
})

const VerificationMatrixDefaults = Schema.Struct({
  cells: Schema.Array(Schema.String),
  headless: Schema.Boolean,
  requiresHardware: Schema.Boolean
})

export const VerificationMatrix = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  source: Schema.String,
  requiredCells: Schema.Array(Schema.String),
  optionalCells: Schema.Array(Schema.String),
  ciCells: Schema.Array(VerificationMatrixCiCell),
  manualGateCells: Schema.Array(VerificationMatrixManualGateCell),
  defaults: VerificationMatrixDefaults,
  rows: Schema.Record(Schema.String, Schema.Unknown)
})
export type VerificationMatrix = typeof VerificationMatrix.Type

const MANIFEST_PATH = "release/semver.json"
const SPEC_SOURCE = "engineering/SPEC.md §25.6"
const BRIDGE_SOURCE = "engineering/SPEC.md §9.3"
const BRIDGE_ALLOWED_CHANGE =
  "fields may be added with defaults; fields may not be removed or reordered"
const CANONICAL_RELEASE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const StrictParseOptions = { errors: "all", onExcessProperty: "error" } as const

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
    "ORIKA semver",
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
    Effect.result,
    Effect.flatMap((result) =>
      Result.match(result, {
        onFailure: (error) =>
          error instanceof PublicApiSnapshotMismatchError
            ? Effect.succeed(error.report)
            : Effect.fail(error),
        onSuccess: (report) => Effect.succeed(report)
      })
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
    const rawMatrix = yield* readJson<unknown>(matrixPath)
    const matrix = yield* decodeVerificationMatrix(rawMatrix)
    const rows = decodeVerificationMatrixRows(matrix)
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

const decodeVerificationMatrix = (
  value: unknown
): Effect.Effect<VerificationMatrix, SemverGuardManifestError, never> =>
  Schema.decodeUnknownEffect(VerificationMatrix)(value, StrictParseOptions).pipe(
    Effect.mapError(
      (error) =>
        new SemverGuardManifestError({
          message: `semver verificationMatrix schema validation failed: ${error.message}`
        })
    )
  )

const decodeVerificationMatrixRows = (matrix: VerificationMatrix): readonly string[] =>
  Object.keys(matrix.rows)

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
      const absolutePath = join(cwd, path)
      if (!(yield* pathExists(absolutePath))) {
        continue
      }
      const manifest = yield* readJson<unknown>(absolutePath).pipe(
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return Effect.fail(new SemverGuardManifestError({ message: `${path} must be a JSON object` }))
  }
  const record = value as Record<string, unknown>
  return Schema.decodeUnknownEffect(SemverPackageVersion)(
    {
      name: record["name"],
      version: record["version"],
      path
    },
    StrictParseOptions
  ).pipe(
    Effect.mapError(
      (error) =>
        new SemverGuardManifestError({
          message: `${path} package manifest schema validation failed: ${error.message}`
        })
    ),
    Effect.flatMap((manifest) =>
      manifest.name.length > 0
        ? Effect.succeed(manifest)
        : Effect.fail(
            new SemverGuardManifestError({ message: `${path} must declare a package name` })
          )
    ),
    Effect.flatMap((manifest) =>
      /^\d+\.\d+\.\d+$/.test(manifest.version)
        ? Effect.succeed(manifest)
        : Effect.fail(
            new SemverGuardManifestError({ message: `${path} must declare a semantic version` })
          )
    )
  )
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
      Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)(body).pipe(
        Effect.map((value) => value as A),
        Effect.mapError(
          (cause) =>
            new SemverGuardFileError({
              operation: "parse-json",
              path,
              message: `failed to parse JSON at ${path}`,
              cause
            })
        )
      )
    )
  )

const pathExists = (path: string): Effect.Effect<boolean, SemverGuardFileError, never> =>
  Effect.tryPromise({
    try: async () => {
      try {
        await stat(path)
        return true
      } catch (cause) {
        if (
          typeof cause === "object" &&
          cause !== null &&
          "code" in cause &&
          cause.code === "ENOENT"
        ) {
          return false
        }
        throw cause
      }
    },
    catch: (cause) =>
      new SemverGuardFileError({
        operation: "stat",
        path,
        message: `failed to stat ${path}`,
        cause
      })
  })

const parseSemverPolicyManifest = (
  value: unknown
): Effect.Effect<SemverPolicyManifest, SemverGuardManifestError, never> =>
  Schema.decodeUnknownEffect(SemverPolicyManifest)(value, StrictParseOptions).pipe(
    Effect.mapError(
      (error) =>
        new SemverGuardManifestError({
          message: `semver manifest schema validation failed: ${error.message}`
        })
    ),
    Effect.flatMap((manifest) =>
      isWorkspaceRelativePath(manifest.publicApiSnapshots)
        ? Effect.succeed(manifest)
        : Effect.fail(
            new SemverGuardManifestError({
              message: "semver publicApiSnapshots must be a workspace-contained relative path"
            })
          )
    ),
    Effect.flatMap((manifest) =>
      isWorkspaceRelativePath(manifest.verificationMatrix)
        ? Effect.succeed(manifest)
        : Effect.fail(
            new SemverGuardManifestError({
              message: "semver verificationMatrix must be a workspace-contained relative path"
            })
          )
    ),
    Effect.flatMap((manifest) =>
      manifest.appendixCRows.every((row) => row.length > 0)
        ? Effect.succeed(manifest)
        : Effect.fail(
            new SemverGuardManifestError({
              message: "semver appendixCRows must be an array of non-empty strings"
            })
          )
    ),
    Effect.flatMap((manifest) =>
      Number.isInteger(manifest.deprecationPolicy.minimumMinorReleases) &&
      manifest.deprecationPolicy.minimumMinorReleases >= 0
        ? Effect.succeed(manifest)
        : Effect.fail(
            new SemverGuardManifestError({
              message:
                "semver deprecationPolicy.minimumMinorReleases must be a non-negative integer"
            })
          )
    )
  )

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
