import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "bun:test"
import { Effect } from "effect"

import type { PublicApiSnapshotReport } from "./public-api-snapshot.js"
import {
  runSemverGuard,
  SemverGuardManifestError,
  type SemverGuardOptions
} from "./semver-guard.js"

interface ManifestOverrides {
  readonly minimumMinorReleases?: number
  readonly requiresJSDocDeprecated?: boolean
}

interface WorkspaceOverrides {
  readonly manifest?: ManifestOverrides
  readonly packageVersion?: string
  readonly writePackageJson?: boolean
}

const cleanApiReport: PublicApiSnapshotReport = {
  passed: true,
  updated: false,
  packages: [],
  changes: []
}

const cleanPublicApiCheck: SemverGuardOptions["publicApiCheck"] = () =>
  Effect.succeed(cleanApiReport)

const makeWorkspace = (overrides: WorkspaceOverrides = {}): Effect.Effect<string, never, never> =>
  Effect.promise(async () => {
    const cwd = await mkdtemp(join(tmpdir(), "orika-semver-guard-"))
    const release = "1.1.0"

    await mkdir(join(cwd, "release"), { recursive: true })
    await mkdir(join(cwd, "packages", "core"), { recursive: true })

    const manifest = {
      schemaVersion: 1,
      source: "engineering/SPEC.md §25.6",
      release,
      releaseKind: "minor",
      publicApiSnapshots: "release/public-api",
      verificationMatrix: "release/verification-matrix.json",
      appendixCRows: ["row-a"],
      bridgeEnvelopePolicy: {
        source: "engineering/SPEC.md §9.3",
        frozenBetweenMajors: true,
        allowedChange: "fields may be added with defaults; fields may not be removed or reordered"
      },
      deprecationPolicy: {
        minimumMinorReleases: overrides.manifest?.minimumMinorReleases ?? 3,
        requiresJSDocDeprecated: overrides.manifest?.requiresJSDocDeprecated ?? true
      }
    }

    await writeFile(join(cwd, "release", "semver.json"), JSON.stringify(manifest), "utf8")

    const verificationMatrix = {
      schemaVersion: 1,
      source: "engineering/SPEC.md §25.6",
      requiredCells: [],
      optionalCells: [],
      ciCells: [],
      manualGateCells: [],
      defaults: { cells: [], headless: true, requiresHardware: false },
      rows: { "row-a": {} }
    }

    await writeFile(
      join(cwd, "release", "verification-matrix.json"),
      JSON.stringify(verificationMatrix),
      "utf8"
    )

    if (overrides.writePackageJson !== false) {
      await writeFile(
        join(cwd, "packages", "core", "package.json"),
        JSON.stringify({
          name: "@orika/core",
          version: overrides.packageVersion ?? release
        }),
        "utf8"
      )
    }

    return cwd
  })

const withWorkspace = <A, E>(
  overrides: WorkspaceOverrides,
  use: (cwd: string) => Effect.Effect<A, E, never>
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const cwd = yield* makeWorkspace(overrides)
    return yield* Effect.ensuring(
      use(cwd),
      Effect.promise(() => rm(cwd, { recursive: true, force: true }))
    )
  })

test("rejects a deprecation window shorter than the SPEC §25.6 floor of three minor releases", () =>
  Effect.runPromise(
    withWorkspace({ manifest: { minimumMinorReleases: 2 } }, (cwd) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          runSemverGuard({ cwd, publicApiCheck: cleanPublicApiCheck })
        )
        expect(error).toBeInstanceOf(SemverGuardManifestError)
        expect((error as SemverGuardManifestError).message).toContain("minimumMinorReleases")
      })
    )
  ))

test("accepts a deprecation window of exactly three minor releases", () =>
  Effect.runPromise(
    withWorkspace({ manifest: { minimumMinorReleases: 3 } }, (cwd) =>
      Effect.gen(function* () {
        const report = yield* runSemverGuard({
          cwd,
          publicApiCheck: cleanPublicApiCheck
        })
        expect(report.passed).toBe(true)
      })
    )
  ))

test("rejects a release when no publishable package manifest binds to the release version", () =>
  Effect.runPromise(
    withWorkspace({ writePackageJson: false }, (cwd) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          runSemverGuard({ cwd, publicApiCheck: cleanPublicApiCheck })
        )
        expect(error).toBeInstanceOf(SemverGuardManifestError)
      })
    )
  ))

test("certifies a release that binds at least one package to the release version", () =>
  Effect.runPromise(
    withWorkspace({}, (cwd) =>
      Effect.gen(function* () {
        const report = yield* runSemverGuard({
          cwd,
          publicApiCheck: cleanPublicApiCheck
        })
        expect(report.passed).toBe(true)
        expect(report.packageVersions.length).toBeGreaterThan(0)
      })
    )
  ))
