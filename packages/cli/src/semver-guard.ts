import { readFile } from "node:fs/promises"
import { join } from "node:path"

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
    cwd: string
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
}

export interface SemverApiChange {
  readonly packageName: string
  readonly symbol: string
  readonly kind: PublicApiChange["kind"]
  readonly classification: SemverChangeClassification
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

export const runSemverGuard = (
  options: SemverGuardOptions
): Effect.Effect<SemverGuardReport, SemverGuardError, never> =>
  Effect.gen(function* () {
    const manifest = yield* readJson<SemverPolicyManifest>(join(options.cwd, MANIFEST_PATH))
    yield* validateManifest(manifest)
    yield* validateAppendixCRows(options.cwd, manifest)

    const apiReport = yield* readPublicApiReport(options)
    const apiChanges = apiReport.changes.map(classifyApiChange)
    const report: SemverGuardReport = {
      passed: apiChanges.every((change) => isAllowedChange(manifest.releaseKind, change)),
      release: manifest.release,
      releaseKind: manifest.releaseKind,
      apiChanges,
      appendixCRows: manifest.appendixCRows
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
  options: SemverGuardOptions
): Effect.Effect<PublicApiSnapshotReport, PublicApiSnapshotError, never> => {
  const check = options.publicApiCheck ?? ((cwd) => runPublicApiCheck({ cwd }))
  return check(options.cwd).pipe(
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
  if (!/^\d+\.\d+\.\d+$/.test(manifest.release)) {
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
  if (manifest.deprecationPolicy.minimumMinorReleases < 3) {
    return Effect.fail(
      new SemverGuardManifestError({
        message: "deprecation policy must retain symbols for at least 3 minor releases"
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
    const matrix = yield* readJson<VerificationMatrix>(join(cwd, manifest.verificationMatrix))
    const rows = Object.keys(matrix.rows ?? {})
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
