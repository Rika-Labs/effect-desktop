import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify as cryptoVerify
} from "node:crypto"
import { createRequire } from "node:module"

const nodeRequire = createRequire(import.meta.url)
const fsPromises = nodeRequire("node:fs/promises") as typeof import("node:fs/promises")
const nodePath = nodeRequire("node:path") as typeof import("node:path")
const { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, symlink, writeFile } =
  fsPromises
const { basename, dirname, join, relative } = nodePath
import { tmpdir } from "node:os"

import { expect, test } from "bun:test"
import { Clock, Effect, Exit, ManagedRuntime, Schema } from "effect"
import { WorkflowEngine } from "effect/unstable/workflow"

const WorkflowMemoryRuntime = ManagedRuntime.make(WorkflowEngine.layerMemory)

import {
  canonicalUpdateManifestBytes,
  BuildCommandFailedError,
  DoctorMissing,
  formatDoctorReport,
  runCli,
  runDocsReleaseGate,
  runDesktopDoctor,
  runDesktopPackage,
  runDesktopReproCheck,
  runReleaseWorkflow,
  runSemverGuard,
  ReleaseConfig,
  type CommandRunner,
  type DocsExampleRunner,
  type DoctorCommandRunner,
  type NotarizeCommandRunner,
  type ReleaseWorkflowApi,
  type PublicApiSnapshotReport,
  type SignCommandRunner
} from "./index.js"
import { UpdateManifest } from "./update-manifest.js"
import { PackageCommandFailedError, type PackageCommandRunner } from "./package-pipeline.js"
import { SignCommandFailedError } from "./signing-pipeline.js"
import { desktopArtifactExtension, desktopPlatformDirectory, hostBinaryName } from "./targets.js"
import type { DesktopArtifactKind, DesktopTargetId } from "./targets.js"

const REPO_ROOT = join(import.meta.dir, "../../..")
const CLI_REPRO_TEST_TIMEOUT_MS = 20_000
const CLI_DOCS_TIMEOUT_TEST_TIMEOUT_MS = 10_000

const testEnv: Record<string, string | undefined> = globalThis.process.env

const readTestEnv = (key: string): string | undefined => testEnv[key]

const writeTestEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete testEnv[key]
    return
  }
  testEnv[key] = value
}

const CliJsonError = Schema.fromJsonString(
  Schema.Struct({
    tag: Schema.String,
    message: Schema.String
  })
)
const decodeCliJsonError = Schema.decodeUnknownSync(CliJsonError)
const CliJsonConfigError = Schema.fromJsonString(
  Schema.Struct({
    tag: Schema.String,
    message: Schema.String,
    field: Schema.optionalKey(Schema.String)
  })
)
const decodeCliJsonConfigError = Schema.decodeUnknownSync(CliJsonConfigError)
const CliJsonMessage = Schema.fromJsonString(
  Schema.Struct({
    message: Schema.String
  })
)
const decodeCliJsonMessage = Schema.decodeUnknownSync(CliJsonMessage)
const PackageMissingBuildArtifactJsonError = Schema.fromJsonString(
  Schema.Struct({
    tag: Schema.Literal("PackageMissingBuildArtifactError"),
    message: Schema.String,
    remediation: Schema.String
  })
)
const decodePackageMissingBuildArtifactJsonError = Schema.decodeUnknownSync(
  PackageMissingBuildArtifactJsonError
)
const JsonObject = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
const decodeJsonObject = Schema.decodeUnknownSync(JsonObject)
const JsonUnknown = Schema.fromJsonString(Schema.Unknown)
const encodeJsonUnknown = Schema.encodeSync(JsonUnknown)
const stringifyJson = (value: unknown, indent?: number): string => {
  const encoded = encodeJsonUnknown(value)
  return indent === undefined ? encoded : JSON.stringify(JSON.parse(encoded), null, indent)
}
const parseJsonObject = Schema.decodeUnknownSync(JsonObject)

class ExpectedPromiseRejection extends Schema.TaggedErrorClass<ExpectedPromiseRejection>()(
  "ExpectedPromiseRejection",
  {}
) {}

const expectEffectPromiseRejects = (
  promise: Promise<unknown>
): Effect.Effect<void, ExpectedPromiseRejection> =>
  Effect.matchEffect(Effect.tryPromise({ try: () => promise, catch: () => undefined }), {
    onFailure: () => Effect.void,
    onSuccess: () => Effect.fail(new ExpectedPromiseRejection())
  })

class TryPromiseError extends Schema.TaggedErrorClass<TryPromiseError>()("TryPromiseError", {
  message: Schema.String
}) {}

const toTryPromiseError = (cause: unknown): TryPromiseError =>
  new TryPromiseError({ message: cause instanceof Error ? cause.message : String(cause) })
const SignReportJson = Schema.fromJsonString(
  Schema.Struct({
    artifacts: Schema.Array(
      Schema.Struct({
        signedPaths: Schema.Array(Schema.String)
      })
    )
  })
)
const decodeSignReportJson = Schema.decodeUnknownSync(SignReportJson)
const NotarizeArtifactsReportJson = Schema.fromJsonString(
  Schema.Struct({
    artifacts: Schema.Array(
      Schema.Struct({
        submissionId: Schema.optionalKey(Schema.String)
      })
    )
  })
)
const decodeNotarizeArtifactsReportJson = Schema.decodeUnknownSync(NotarizeArtifactsReportJson)
const NotarizeStepsReportJson = Schema.fromJsonString(
  Schema.Struct({
    steps: Schema.Array(
      Schema.Struct({
        command: Schema.optionalKey(Schema.Array(Schema.String))
      })
    )
  })
)
const decodeNotarizeStepsReportJson = Schema.decodeUnknownSync(NotarizeStepsReportJson)
const BuildStepsReportJson = Schema.fromJsonString(
  Schema.Struct({
    steps: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        status: Schema.String,
        provider: Schema.optionalKey(Schema.String),
        reason: Schema.optionalKey(Schema.String)
      })
    )
  })
)
const decodeBuildStepsReportJson = Schema.decodeUnknownSync(BuildStepsReportJson)
const DocsManifestPagesJson = Schema.fromJsonString(
  Schema.Struct({
    pages: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        title: Schema.String,
        path: Schema.String
      })
    )
  })
)
const decodeDocsManifestPagesJson = Schema.decodeUnknownSync(DocsManifestPagesJson)
const BuildChromeManifestJson = Schema.fromJsonString(
  Schema.Struct({
    hostManifest: Schema.Struct({
      webEngine: Schema.String,
      webEngineRuntime: Schema.String,
      webEnginePath: Schema.String
    })
  })
)
const decodeBuildChromeManifestJson = Schema.decodeUnknownSync(BuildChromeManifestJson)
const BuildChromeReportJson = Schema.fromJsonString(
  Schema.Struct({
    providers: Schema.Struct({
      webEngine: Schema.String
    }),
    providerMeasurements: Schema.Array(
      Schema.Struct({
        webEngine: Schema.String
      })
    ),
    steps: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        provider: Schema.optionalKey(Schema.String),
        elapsedMs: Schema.Number
      })
    )
  })
)
const decodeBuildChromeReportJson = Schema.decodeUnknownSync(BuildChromeReportJson)
const RendererCspDirectiveJson = Schema.Struct({
  name: Schema.String,
  values: Schema.Array(Schema.String)
})
const RendererSecurityManifestJson = Schema.fromJsonString(
  Schema.Struct({
    rendererManifest: Schema.Struct({
      navigationPolicy: Schema.String,
      devtoolsInProd: Schema.Boolean,
      csp: Schema.Struct({
        directives: Schema.Array(RendererCspDirectiveJson)
      })
    })
  })
)
const decodeRendererSecurityManifestJson = Schema.decodeUnknownSync(RendererSecurityManifestJson)
const RendererDisabledCspManifestJson = Schema.fromJsonString(
  Schema.Struct({
    rendererManifest: Schema.Struct({
      csp: Schema.Struct({
        directives: Schema.Array(Schema.Unknown)
      })
    })
  })
)
const decodeRendererDisabledCspManifestJson = Schema.decodeUnknownSync(
  RendererDisabledCspManifestJson
)
const HostWindowsManifestJson = Schema.fromJsonString(
  Schema.Struct({
    hostManifest: Schema.Struct({
      windows: Schema.Unknown
    }),
    runtimeManifest: Schema.Struct({
      env: Schema.Record(Schema.String, Schema.String)
    })
  })
)
const decodeHostWindowsManifestJson = Schema.decodeUnknownSync(HostWindowsManifestJson)
const PackageAppMetadataJson = Schema.fromJsonString(
  Schema.Struct({
    kind: Schema.String,
    sha256: Schema.String,
    providerBudgetChecks: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          metric: Schema.String,
          budget: Schema.Number,
          status: Schema.String
        })
      )
    )
  })
)
const decodePackageAppMetadataJson = Schema.decodeUnknownSync(PackageAppMetadataJson)
const LinuxPackageArtifactJson = Schema.fromJsonString(
  Schema.Struct({
    kind: Schema.String,
    sizeBytes: Schema.Number,
    linuxIntegration: Schema.optionalKey(
      Schema.Struct({
        desktopFile: Schema.String,
        appStreamId: Schema.String,
        flatpakAppId: Schema.String,
        snapName: Schema.String
      })
    )
  })
)
const decodeLinuxPackageArtifactJson = Schema.decodeUnknownSync(LinuxPackageArtifactJson)
const PublishReportJson = Schema.fromJsonString(
  Schema.Struct({
    manifestPath: Schema.String
  })
)
const decodePublishReportJson = Schema.decodeUnknownSync(PublishReportJson)
const UpdateManifestJson = Schema.fromJsonString(UpdateManifest)
const decodeUpdateManifestJson = Schema.decodeUnknownSync(UpdateManifestJson)
const ProductionCheckJsonReport = Schema.fromJsonString(
  Schema.Struct({
    passed: Schema.Boolean,
    failures: Schema.Array(
      Schema.Struct({
        rule: Schema.String
      })
    ),
    acknowledgements: Schema.Array(Schema.Unknown)
  })
)
const decodeProductionCheckJsonReport = Schema.decodeUnknownSync(ProductionCheckJsonReport)
const DoctorJsonReport = Schema.fromJsonString(
  Schema.Struct({
    passed: Schema.Boolean,
    probes: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        status: Schema.String,
        message: Schema.optionalKey(Schema.String),
        installCommand: Schema.optionalKey(Schema.String),
        installHint: Schema.optionalKey(Schema.String),
        evidence: Schema.optionalKey(
          Schema.Array(
            Schema.Struct({
              key: Schema.String,
              value: Schema.String
            })
          )
        )
      })
    )
  })
)
const decodeDoctorJsonReport = Schema.decodeUnknownSync(DoctorJsonReport)
const ReproDiffJsonError = Schema.fromJsonString(
  Schema.Struct({
    tag: Schema.Literal("ReproDiffError"),
    report: Schema.Struct({
      differences: Schema.Array(
        Schema.Struct({
          relativePath: Schema.String,
          kind: Schema.String,
          firstDifferenceOffset: Schema.optionalKey(Schema.Number),
          firstEntryKind: Schema.optionalKey(Schema.String),
          secondEntryKind: Schema.optionalKey(Schema.String),
          firstSymlinkTarget: Schema.optionalKey(Schema.String),
          secondSymlinkTarget: Schema.optionalKey(Schema.String),
          firstMode: Schema.optionalKey(Schema.Number),
          secondMode: Schema.optionalKey(Schema.Number)
        })
      )
    })
  })
)
const decodeReproDiffJsonError = Schema.decodeUnknownSync(ReproDiffJsonError)

const runBuildFixtureIo = (
  invocation: Parameters<CommandRunner>[0],
  run: () => Promise<unknown>
): Effect.Effect<void, BuildCommandFailedError, never> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new BuildCommandFailedError({
        step: invocation.step,
        command: [invocation.command, ...invocation.args],
        cwd: invocation.cwd,
        exitCode: undefined,
        message: cause instanceof Error ? cause.message : String(cause)
      })
  }).pipe(Effect.asVoid)

interface BuildFixtureOutputOptions {
  readonly rendererHtml?: string
  readonly runtimeJs?: string
  readonly nativeHost?: string
}

const writeBuildFixtureOutput = (
  invocation: Parameters<CommandRunner>[0],
  options: BuildFixtureOutputOptions = {}
): Effect.Effect<void, BuildCommandFailedError, never> =>
  Effect.gen(function* () {
    if (invocation.step === "renderer") {
      yield* runBuildFixtureIo(invocation, () =>
        mkdir(join(invocation.cwd, "dist"), { recursive: true })
      )
      yield* runBuildFixtureIo(invocation, () =>
        writeFile(join(invocation.cwd, "dist", "index.html"), options.rendererHtml ?? "<h1>ok</h1>")
      )
      return
    }

    if (invocation.step === "runtime") {
      const outdir = invocation.args[invocation.args.indexOf("--outdir") + 1]
      const entryPath = invocation.args[1]
      if (outdir === undefined || entryPath === undefined) {
        return
      }

      const outputFile = basename(entryPath).replace(/\.tsx?$/, ".js")
      yield* runBuildFixtureIo(invocation, () => mkdir(outdir, { recursive: true }))
      yield* runBuildFixtureIo(invocation, () =>
        writeFile(join(outdir, outputFile), options.runtimeJs ?? "console.log('ok')\n")
      )
      return
    }

    if (invocation.step === "native-host") {
      yield* runBuildFixtureIo(invocation, () =>
        mkdir(join(invocation.cwd, "target", "release"), { recursive: true })
      )
      yield* runBuildFixtureIo(invocation, () =>
        writeFile(join(invocation.cwd, "target", "release", "host"), options.nativeHost ?? "host")
      )
    }
  })

const runSignFixtureIo = (
  invocation: Parameters<SignCommandRunner>[0],
  run: () => Promise<unknown>
): Effect.Effect<void, SignCommandFailedError, never> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new SignCommandFailedError({
        step: invocation.step,
        command: [invocation.command, ...invocation.args],
        cwd: invocation.cwd,
        exitCode: undefined,
        message: cause instanceof Error ? cause.message : String(cause)
      })
  }).pipe(Effect.asVoid)

const runPackageFixtureIo = (
  invocation: Parameters<PackageCommandRunner>[0],
  run: () => Promise<unknown>
): Effect.Effect<void, PackageCommandFailedError, never> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => packageFixtureError(invocation, cause)
  }).pipe(Effect.asVoid)

const readPackageFixtureText = (
  invocation: Parameters<PackageCommandRunner>[0],
  path: string
): Effect.Effect<string, PackageCommandFailedError, never> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) => packageFixtureError(invocation, cause)
  })

const packageFixtureError = (
  invocation: Parameters<PackageCommandRunner>[0],
  cause: unknown
): PackageCommandFailedError =>
  new PackageCommandFailedError({
    step: invocation.step,
    command: [invocation.command, ...invocation.args],
    cwd: invocation.cwd,
    exitCode: undefined,
    message: cause instanceof Error ? cause.message : String(cause)
  })

test("doctor report renders selected layer providers", () => {
  const output = formatDoctorReport({
    passed: true,
    ci: false,
    platform: "darwin",
    arch: "arm64",
    probes: [],
    layerGraph: {
      appId: "notes",
      providers: { runtime: "test", webview: "system" },
      nodes: [],
      providerFacts: [
        {
          id: "test",
          kind: "runtime",
          capabilities: ["FileSystem"]
        },
        {
          id: "system",
          kind: "webview",
          capabilities: ["WindowWebView"]
        }
      ],
      failures: []
    }
  })

  expect(output).toContain("layer providers   runtime:test")
  expect(output).toContain("webview:system")
  expect(output).toContain("layer failures    0")
})

test("desktop --help exits zero with root usage on stdout", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stdout: string[] = []
      const stderr: string[] = []
      const exitCode = yield* runCli({
        argv: ["--help"],
        cwd: process.cwd(),
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: (text) => {
          stderr.push(text)
        }
      })

      expect(exitCode).toBe(0)
      expect(stdout.join("")).toContain("Usage: desktop <command>")
      expect(stderr.join("")).toBe("")
    })
  ))

test("desktop does not expose unimplemented deferred commands", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const commands = [
        "init",
        "dev",
        "typecheck",
        "lint",
        "test",
        "info",
        "generate-types",
        "migrate",
        "clean",
        "inspect",
        "replay"
      ] as const

      for (const command of commands) {
        const stdout: string[] = []
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: [command],
          cwd: process.cwd(),
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stdout.join("")).toContain("USAGE")
        expect(stdout.join("")).toContain("desktop <subcommand>")
        expect(stdout.join("")).not.toContain(`  ${command}`)
        expect(stderr.join("")).toContain(`Unknown subcommand "${command}" for "desktop"`)
      }
    })
  ))

test("desktop release --help exits zero with workflow usage", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stdout: string[] = []
      const exitCode = yield* runCli({
        argv: ["release", "--help"],
        cwd: process.cwd(),
        packageCommandRunner: () => Effect.die("release should not run for help"),
        signCommandRunner: () => Effect.die("release should not run for help"),
        notarizeCommandRunner: () => Effect.die("release should not run for help"),
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })

      expect(exitCode).toBe(0)
      expect(stdout.join("")).toContain("desktop release")
      expect(stdout.join("")).toContain("--version")
    })
  ))

test("release workflow runs package sign notarize publish activities in order", () =>
  WorkflowMemoryRuntime.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const services = fakeReleaseServices(calls, "macos-arm64")

      const report = yield* runReleaseWorkflow(
        new ReleaseConfig({
          configPath: "desktop.config.ts",
          platform: "macos-arm64",
          version: "1.2.3"
        }),
        services
      )

      expect(calls).toEqual(["package", "sign", "notarize", "publish"])
      expect(report).toMatchObject({
        appId: "dev.effect-desktop.test",
        appVersion: "1.2.3",
        target: "macos-arm64",
        manifestPath: "/release/update-manifest.json"
      })
      expect(report.phases.map((phase) => phase.phase)).toEqual([
        "package",
        "sign",
        "notarize",
        "publish"
      ])
    })
  ))

test("release workflow skips notarization for non-macOS targets", () =>
  WorkflowMemoryRuntime.runPromise(
    Effect.gen(function* () {
      const calls: string[] = []
      const services = fakeReleaseServices(calls, "linux-x64")

      const report = yield* runReleaseWorkflow(
        new ReleaseConfig({
          configPath: "desktop.config.ts",
          platform: "linux-x64"
        }),
        services
      )

      expect(calls).toEqual(["package", "sign", "publish"])
      expect(report.phases).toContainEqual({
        phase: "notarize",
        skipped: true,
        artifacts: 0
      })
    })
  ))

test("desktop value-flag usage errors honor --json", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stdout: string[] = []
      const stderr: string[] = []
      const exitCode = yield* runCli({
        argv: ["build", "--config", "--json"],
        cwd: process.cwd(),
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: (text) => {
          stderr.push(text)
        }
      })

      const payload = decodeCliJsonError(stderr.join(""))
      expect(exitCode).toBe(1)
      expect(stdout.join("")).toBe("")
      expect(payload).toEqual({
        tag: "CliUsageError",
        message: "--config requires a value"
      })
    })
  ))

test("desktop check --production exits non-zero for unacknowledged CSP weakening", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "effect-desktop-cli-")))
      try {
        yield* Effect.promise(() =>
          writeFile(
            join(directory, "desktop.config.ts"),
            [
              "export default {",
              "  app: {",
              "    id: 'dev.effect-desktop.production-check',",
              "    name: 'Production Check',",
              "    version: '1.0.0'",
              "  },",
              "  security: {",
              "    csp: { policy: \"script-src 'self' 'unsafe-inline'\" }",
              "  }",
              "}"
            ].join("\n")
          )
        )

        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["check", "--production", "--config", "desktop.config.ts"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("weakened-csp")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --production --json writes failed reports to stderr", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "effect-desktop-cli-")))
      try {
        yield* Effect.promise(() =>
          writeFile(
            join(directory, "desktop.config.ts"),
            [
              "export default {",
              "  app: {",
              "    id: 'dev.effect-desktop.production-check',",
              "    name: 'Production Check',",
              "    version: '1.0.0'",
              "  },",
              "  security: {",
              "    csp: { policy: \"script-src 'self' 'unsafe-inline'\" }",
              "  }",
              "}"
            ].join("\n")
          )
        )

        const stdout: string[] = []
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["check", "--production", "--config", "desktop.config.ts", "--json"],
          cwd: directory,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const report = decodeProductionCheckJsonReport(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(stdout.join("")).toBe("")
        expect(report.passed).toBe(false)
        expect(report.failures.map((failure) => failure.rule)).toContain("weakened-csp")
        expect(report.acknowledgements).toEqual([])
        expect(stderr.join("")).not.toContain("FAIL weakened-csp")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --production --json emits structured config-loading failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "effect-desktop-cli-")))
      try {
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["check", "--production", "--config", "missing.config.ts", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonConfigError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("BuildConfigError")
        expect(payload.tag).toBe("BuildConfigError")
        expect(payload.message).toContain("missing.config.ts")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --production rejects duplicate config flags before loading config", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "effect-desktop-cli-")))
      try {
        const stdout: string[] = []
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: [
            "check",
            "--production",
            "--config",
            "first.config.ts",
            "--config",
            "second.config.ts"
          ],
          cwd: directory,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(stdout.join("")).toBe("")
        expect(payload.tag).toBe("CliUsageError")
        expect(payload.message).toContain("--config")
        expect(payload.message).toContain("at most once")
        expect(stderr.join("")).not.toContain("missing.config")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --production rejects missing app metadata before security checks", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "effect-desktop-cli-")))
      try {
        yield* Effect.promise(() =>
          writeFile(
            join(directory, "desktop.config.ts"),
            [
              "export default {",
              "  app: {",
              "    id: 'dev.effect-desktop.production-check',",
              "    name: 'Production Check'",
              "  },",
              "  security: {",
              "    csp: { policy: \"script-src 'self' 'unsafe-inline'\" }",
              "  }",
              "}"
            ].join("\n")
          )
        )

        const stdout: string[] = []
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["check", "--production", "--config", "desktop.config.ts", "--json"],
          cwd: directory,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonConfigError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(stdout.join("")).toBe("")
        expect(payload).toEqual({
          tag: "BuildConfigError",
          message: "app.version is required",
          field: "app.version"
        })
        expect(stderr.join("")).not.toContain("weakened-csp")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --production --json emits structured renderer-loading failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "effect-desktop-cli-")))
      try {
        yield* Effect.promise(() =>
          writeFile(
            join(directory, "desktop.config.ts"),
            [
              "export default {",
              "  app: {",
              "    id: 'dev.effect-desktop.production-check',",
              "    name: 'Production Check',",
              "    version: '1.0.0'",
              "  }",
              "}"
            ].join("\n")
          )
        )
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: [
            "check",
            "--production",
            "--renderer",
            "missing.ts",
            "--config",
            "desktop.config.ts",
            "--json"
          ],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonConfigError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.message).toContain("missing.ts")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --production exits zero and reports acknowledged weakenings", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "effect-desktop-cli-")))
      try {
        yield* Effect.promise(() =>
          writeFile(
            join(directory, "desktop.config.ts"),
            [
              "export default {",
              "  app: {",
              "    id: 'dev.effect-desktop.production-check',",
              "    name: 'Production Check',",
              "    version: '1.0.0'",
              "  },",
              "  security: {",
              "    csp: {",
              "      policy: \"script-src 'self' 'unsafe-inline'\",",
              "      acknowledgeWeakening: true,",
              "      justification: 'inline bootstrap script exception'",
              "    }",
              "  }",
              "}"
            ].join("\n")
          )
        )

        const stdout: string[] = []
        const exitCode = yield* runCli({
          argv: ["check", "--production", "--config", "desktop.config.ts"],
          cwd: directory,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
        expect(stdout.join("")).toContain("ACK weakened-csp")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --production --json writes passed reports to stdout", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "effect-desktop-cli-")))
      try {
        yield* Effect.promise(() =>
          writeFile(
            join(directory, "desktop.config.ts"),
            [
              "export default {",
              "  app: {",
              "    id: 'dev.effect-desktop.production-check',",
              "    name: 'Production Check',",
              "    version: '1.0.0'",
              "  }",
              "}"
            ].join("\n")
          )
        )

        const stdout: string[] = []
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["check", "--production", "--config", "desktop.config.ts", "--json"],
          cwd: directory,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const report = decodeProductionCheckJsonReport(stdout.join(""))
        expect(exitCode).toBe(0)
        expect(stderr.join("")).toBe("")
        expect(report).toEqual({
          passed: true,
          failures: [],
          acknowledgements: []
        })
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --production fails when an explicit renderer scan file is unreadable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "effect-desktop-cli-")))
      try {
        yield* Effect.promise(() =>
          writeFile(
            join(directory, "desktop.config.ts"),
            [
              "export default {",
              "  app: {",
              "    id: 'dev.effect-desktop.production-check',",
              "    name: 'Production Check',",
              "    version: '1.0.0'",
              "  }",
              "}"
            ].join("\n")
          )
        )

        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["check", "--production", "--renderer", "missing.ts"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("missing.ts")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --production reports bridge protocol barrel imports in renderer files", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "effect-desktop-cli-")))
      try {
        yield* Effect.promise(() =>
          writeFile(
            join(directory, "desktop.config.ts"),
            [
              "export default {",
              "  app: {",
              "    id: 'dev.effect-desktop.production-check',",
              "    name: 'Production Check',",
              "    version: '1.0.0'",
              "  }",
              "}"
            ].join("\n")
          )
        )
        yield* Effect.promise(() => mkdir(join(directory, "src", "renderer"), { recursive: true }))
        yield* Effect.promise(() =>
          writeFile(
            join(directory, "src", "renderer", "main.ts"),
            "import { HostProtocolRequestEnvelope } from '@orika/bridge'\n"
          )
        )

        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: [
            "check",
            "--production",
            "--renderer",
            "src/renderer/main.ts",
            "--config",
            "desktop.config.ts"
          ],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("renderer-native-host-protocol")
        expect(stderr.join("")).toContain("src/renderer/main.ts:1")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --production treats missing renderer path as a usage error", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stderr: string[] = []
      const exitCode = yield* runCli({
        argv: ["check", "--production", "--renderer", "--config", "desktop.config.ts"],
        cwd: process.cwd(),
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })

      expect(exitCode).toBe(1)
      expect(stderr.join("").length).toBeGreaterThan(0)
    })
  ))

test("desktop check rejects mixed mode flags before dispatch", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-check-modes-"))
      )
      try {
        yield* writeReleaseFixture(directory)
        yield* Effect.promise(() =>
          writeFile(
            join(directory, "desktop.config.ts"),
            [
              "export default {",
              "  app: {",
              "    id: 'dev.effect-desktop.mixed-check',",
              "    name: 'Mixed Check',",
              "    version: '0.0.0'",
              "  },",
              "  runtime: { engine: 'bun', entry: 'src/main.ts' },",
              "  renderer: { framework: 'react', entry: 'src/App.tsx', dist: 'dist/renderer' },",
              "  security: { csp: { policy: \"script-src 'self' 'unsafe-inline'\" } }",
              "}"
            ].join("\n")
          )
        )
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--release", "--production", "--config", "desktop.config.ts", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("CliUsageError")
        expect(payload.message).toContain("mutually exclusive")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop commands reject unknown flags before execution", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: readonly (readonly string[])[] = [
        ["package", "--platfrom", "linux-x64", "--help"],
        ["build", "--help", "--jsno"],
        ["doctor", "--definitely-unknown"]
      ]
      for (const argv of cases) {
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv,
          cwd: process.cwd(),
          doctorCommandRunner: doctorRunner({
            cargo: true,
            rustc: true,
            "xcode-select": true,
            hdiutil: true
          }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("CliUsageError")
        expect(payload.message).toContain("unknown flag")
      }
    })
  ))

test("desktop doctor reports typed missing Rust toolchain failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-doctor-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* Effect.promise(() =>
          writeFile(join(directory, "package.json"), '{"packageManager":"bun@1.3.13"}\n')
        )
        yield* Effect.promise(() => writeFile(join(directory, "bun.lock"), ""))
        const runner = doctorRunner({
          cargo: false,
          rustc: true,
          "pkg-config": true,
          "dpkg-deb": true
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["doctor", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          platform: "linux",
          arch: "x64",
          bunVersion: "1.3.13",
          doctorCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const report = decodeDoctorJsonReport(stderr.join(""))
        const rustProbe = report.probes.find((probe) => probe.name === "rust-toolchain")
        expect(exitCode).toBe(1)
        expect(report.passed).toBe(false)
        expect(rustProbe?.status).toBe("missing")
        expect(rustProbe?.installCommand).toBe("install cargo")
        expect(rustProbe?.installHint).toBeUndefined()
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop doctor exits zero with warnings for optional signing and host cache probes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-doctor-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* Effect.promise(() =>
          writeFile(join(directory, "package.json"), '{"packageManager":"bun@1.3.13"}\n')
        )
        yield* Effect.promise(() => writeFile(join(directory, "bun.lock"), ""))
        const runner = doctorRunner({
          cargo: true,
          rustc: true,
          "xcode-select": true,
          hdiutil: true
        })
        const stdout: string[] = []

        const exitCode = yield* runCli({
          argv: ["doctor", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          platform: "darwin",
          arch: "arm64",
          bunVersion: "1.3.13",
          doctorCommandRunner: runner,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        const output = stdout.join("")
        expect(exitCode).toBe(0)
        expect(output).toContain("WARN")
        expect(output).toContain("signing credentials are not configured")
        expect(output).toContain("native host build cache is empty")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop doctor reports native capability truth from the generated parity matrix", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-doctor-capabilities-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* Effect.promise(() =>
          writeFile(join(directory, "package.json"), '{"packageManager":"bun@1.3.13"}\n')
        )
        yield* Effect.promise(() => writeFile(join(directory, "bun.lock"), ""))
        const stdout: string[] = []
        const matrix = parseJsonObject(
          yield* Effect.promise(() =>
            readFile(join(REPO_ROOT, "packages/cli/src/native-parity-matrix.json"), "utf8")
          )
        ) as unknown as {
          readonly summary: {
            readonly total: number
            readonly routed: number
            readonly missing: number
          }
        }

        const exitCode = yield* runCli({
          argv: ["doctor", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          platform: "linux",
          arch: "x64",
          bunVersion: "1.3.13",
          doctorCommandRunner: doctorRunner({
            cargo: true,
            rustc: true,
            "pkg-config": true,
            "dpkg-deb": true
          }),
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        const report = decodeDoctorJsonReport(stdout.join(""))
        const capabilityProbe = report.probes.find((probe) => probe.name === "native-capabilities")
        expect(exitCode).toBe(0)
        expect(capabilityProbe).toMatchObject({
          status: matrix.summary.missing === 0 ? "ok" : "warning",
          message: `native capability matrix reports ${matrix.summary.total} methods, ${matrix.summary.routed} host-routed, ${matrix.summary.missing} missing host routes`
        })
        expect(capabilityProbe?.evidence).toEqual([
          { key: "source", value: "packages/cli/src/native-parity-matrix.json" },
          { key: "total", value: String(matrix.summary.total) },
          { key: "routed", value: String(matrix.summary.routed) },
          { key: "missing", value: String(matrix.summary.missing) }
        ])
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop doctor fails when native capability truth is malformed", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-doctor-capabilities-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* Effect.promise(() =>
          writeFile(join(directory, "package.json"), '{"packageManager":"bun@1.3.13"}\n')
        )
        yield* Effect.promise(() => writeFile(join(directory, "bun.lock"), ""))
        const matrixPath = join(directory, "native-parity-matrix.json")
        yield* Effect.promise(() =>
          writeFile(matrixPath, '{"rows":[],"summary":{"total":"bad"}}\n')
        )

        const error = yield* runDesktopDoctor({
          cwd: directory,
          configPath: "apps/inspector/desktop.config.ts",
          ci: false,
          platform: "linux",
          arch: "x64",
          bunVersion: "1.3.13",
          nativeParityMatrixPath: matrixPath,
          commandRunner: doctorRunner({
            cargo: true,
            rustc: true,
            "pkg-config": true,
            "dpkg-deb": true
          })
        }).pipe(Effect.flip)

        expect(error).toMatchObject({
          _tag: "DoctorCapabilityTruthUnavailable",
          reason: "invalid",
          path: matrixPath,
          message: `native capability parity matrix is invalid at ${matrixPath}`
        })
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop doctor suppresses signing warning when signing config is present", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-doctor-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: {
            macos: {
              identity: "Developer ID Application: Example",
              teamId: "ABCD1234",
              notarytoolProfile: "release-profile"
            }
          }
        })
        yield* Effect.promise(() =>
          writeFile(join(directory, "package.json"), '{"packageManager":"bun@1.3.13"}\n')
        )
        yield* Effect.promise(() => writeFile(join(directory, "bun.lock"), ""))
        const runner = doctorRunner({
          cargo: true,
          rustc: true,
          "xcode-select": true,
          hdiutil: true
        })
        const stdout: string[] = []

        const exitCode = yield* runCli({
          argv: ["doctor", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          platform: "darwin",
          arch: "arm64",
          bunVersion: "1.3.13",
          doctorCommandRunner: runner,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        const output = stdout.join("")
        expect(exitCode).toBe(0)
        expect(output).toContain("WARN")
        expect(output).not.toContain("signing credentials are not configured")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop doctor reads signing credentials from injected environment", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-doctor-env-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: {
            macos: {
              identity: "Developer ID Application: Example"
            }
          }
        })
        yield* Effect.promise(() =>
          writeFile(join(directory, "package.json"), '{"packageManager":"bun@1.3.13"}\n')
        )
        yield* Effect.promise(() => writeFile(join(directory, "bun.lock"), ""))
        const stdout: string[] = []

        const exitCode = yield* runCli({
          argv: ["doctor", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          platform: "darwin",
          arch: "arm64",
          bunVersion: "1.3.13",
          doctorCommandRunner: doctorRunner({
            cargo: true,
            rustc: true,
            "xcode-select": true,
            hdiutil: true
          }),
          env: {
            APPLE_TEAM_ID: "ABCD1234",
            APPLE_ID: "release@example.invalid",
            APPLE_APP_SPECIFIC_PASSWORD: "secret"
          },
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
        expect(stdout.join("")).not.toContain("signing credentials are not configured")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop doctor reports config import failures with the import cause", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-doctor-config-import-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* Effect.promise(() =>
          writeFile(
            join(directory, "apps", "inspector", "desktop.config.ts"),
            'throw new Error("config exploded")\nexport default {}\n'
          )
        )
        yield* Effect.promise(() =>
          writeFile(join(directory, "package.json"), '{"packageManager":"bun@1.3.13"}\n')
        )
        yield* Effect.promise(() => writeFile(join(directory, "bun.lock"), ""))
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["doctor", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          platform: "darwin",
          arch: "arm64",
          bunVersion: "1.3.13",
          doctorCommandRunner: doctorRunner({
            cargo: true,
            rustc: true,
            "xcode-select": true,
            hdiutil: true
          }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const output = stderr.join("")
        expect(exitCode).toBe(1)
        expect(output).toContain("MISSING  config")
        expect(output).toContain("desktop config import failed")
        expect(output).toContain("Cannot access")
        expect(output).not.toContain("desktop config must export a default object")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop doctor rejects empty app metadata strings", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-doctor-empty-metadata-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          app: {
            id: "",
            name: "",
            version: ""
          }
        })
        yield* Effect.promise(() =>
          writeFile(join(directory, "package.json"), '{"packageManager":"bun@1.3.13"}\n')
        )
        yield* Effect.promise(() => writeFile(join(directory, "bun.lock"), ""))
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["doctor", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          platform: "darwin",
          arch: "arm64",
          bunVersion: "1.3.13",
          doctorCommandRunner: doctorRunner({
            cargo: true,
            rustc: true,
            "xcode-select": true,
            hdiutil: true
          }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const report = decodeDoctorJsonReport(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(report.passed).toBe(false)
        expect(report.probes.find((probe) => probe.name === "config")?.status).toBe("missing")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop doctor rejects config paths outside the workspace", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-doctor-contained-"))
      )
      const outsideDirectory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-doctor-outside-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writePlaygroundFixture(outsideDirectory)
        yield* Effect.promise(() =>
          writeFile(join(directory, "package.json"), '{"packageManager":"bun@1.3.13"}\n')
        )
        yield* Effect.promise(() => writeFile(join(directory, "bun.lock"), ""))
        const outsideConfig = join(outsideDirectory, "apps", "inspector", "desktop.config.ts")
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["doctor", "--config", relative(directory, outsideConfig), "--json"],
          cwd: directory,
          platform: "darwin",
          arch: "arm64",
          bunVersion: "1.3.13",
          doctorCommandRunner: doctorRunner({
            cargo: true,
            rustc: true,
            "xcode-select": true,
            hdiutil: true
          }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const report = decodeDoctorJsonReport(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(report.passed).toBe(false)
        expect(report.probes.find((probe) => probe.name === "config")?.status).toBe("missing")
        expect(stderr.join("")).toContain("inside the workspace")
        expect(stderr.join("")).not.toContain(
          "desktop doctor --config apps/inspector/desktop.config.ts"
        )
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        yield* Effect.promise(() => rm(outsideDirectory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop doctor rejects invalid security config", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-doctor-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          security: { externalNavigation: "teleport", devtoolsInProd: "sometimes" }
        })
        yield* Effect.promise(() =>
          writeFile(join(directory, "package.json"), '{"packageManager":"bun@1.3.13"}\n')
        )
        yield* Effect.promise(() => writeFile(join(directory, "bun.lock"), ""))
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["doctor", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          platform: "darwin",
          arch: "arm64",
          bunVersion: "1.3.13",
          doctorCommandRunner: doctorRunner({
            cargo: true,
            rustc: true,
            "xcode-select": true,
            hdiutil: true
          }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const report = decodeDoctorJsonReport(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(report.passed).toBe(false)
        expect(report.probes.find((probe) => probe.name === "config")?.status).toBe("missing")
        expect(stderr.join("")).toContain("security.externalNavigation")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop doctor rejects protocol limits above caps", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-doctor-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          protocol: {
            limits: {
              maxFrameBytes: 999_999_999,
              maxConcurrentRequestsPerWindow: 999_999,
              maxConcurrentStreamsPerWindow: 999_999
            }
          }
        })
        yield* Effect.promise(() =>
          writeFile(join(directory, "package.json"), '{"packageManager":"bun@1.3.13"}\n')
        )
        yield* Effect.promise(() => writeFile(join(directory, "bun.lock"), ""))
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["doctor", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          platform: "darwin",
          arch: "arm64",
          bunVersion: "1.3.13",
          doctorCommandRunner: doctorRunner({
            cargo: true,
            rustc: true,
            "xcode-select": true,
            hdiutil: true
          }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("protocol.limits.maxFrameBytes")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop doctor fails when package manager state is not Bun-pinned", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-doctor-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* Effect.promise(() =>
          writeFile(join(directory, "package.json"), '{"packageManager":"npm@10.0.0"}\n')
        )
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["doctor", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          platform: "darwin",
          arch: "arm64",
          bunVersion: "1.3.13",
          doctorCommandRunner: doctorRunner({
            cargo: true,
            rustc: true,
            "xcode-select": true,
            hdiutil: true
          }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("package.json#packageManager must be pinned to bun")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test(
  "desktop check --repro exits zero for byte-identical staged and packaged outputs",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
        )
        try {
          yield* writePlaygroundFixture(directory)
          const commandRunner = deterministicBuildRunner()
          const packageRunner = deterministicPackageRunner(() => "deb")
          const stdout: string[] = []

          const exitCode = yield* runCli({
            argv: [
              "check",
              "--repro",
              "--config",
              "apps/inspector/desktop.config.ts",
              "--platform",
              "linux-x64",
              "--artifact",
              "deb"
            ],
            cwd: directory,
            hostTarget: "linux-x64",
            commandRunner,
            packageCommandRunner: packageRunner,
            writeStdout: (text) => {
              stdout.push(text)
            },
            writeStderr: () => {}
          })

          expect(exitCode).toBe(0)
          expect(stdout.join("")).toContain("byte-identical")
          expect(stdout.join("")).toContain("target            linux-x64")
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      })
    ),
  CLI_REPRO_TEST_TIMEOUT_MS
)

test(
  "desktop check --repro reports the differing file and byte offset",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
        )
        try {
          yield* writePlaygroundFixture(directory)
          const commandRunner = deterministicBuildRunner()
          let packagePass = 0
          const packageRunner = deterministicPackageRunner(() => {
            packagePass += 1
            return packagePass === 1 ? "deb-a" : "deb-b"
          })
          const stderr: string[] = []

          const exitCode = yield* runCli({
            argv: [
              "check",
              "--repro",
              "--config",
              "apps/inspector/desktop.config.ts",
              "--platform",
              "linux-x64",
              "--artifact",
              "deb"
            ],
            cwd: directory,
            hostTarget: "linux-x64",
            commandRunner,
            packageCommandRunner: packageRunner,
            writeStdout: () => {},
            writeStderr: (text) => {
              stderr.push(text)
            }
          })

          const output = stderr.join("")
          expect(exitCode).toBe(1)
          expect(output).toContain("package-output")
          expect(output).toContain(".deb")
          expect(output).toContain("offset          4")
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      })
    ),
  CLI_REPRO_TEST_TIMEOUT_MS
)

test(
  "desktop check --repro --json returns structured diff reports",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
        )
        try {
          yield* writePlaygroundFixture(directory)
          const commandRunner = deterministicBuildRunner()
          let packagePass = 0
          const packageRunner = deterministicPackageRunner(() => {
            packagePass += 1
            return packagePass === 1 ? "deb-a" : "deb-b"
          })
          const stderr: string[] = []

          const exitCode = yield* runCli({
            argv: [
              "check",
              "--repro",
              "--config",
              "apps/inspector/desktop.config.ts",
              "--platform",
              "linux-x64",
              "--artifact",
              "deb",
              "--json"
            ],
            cwd: directory,
            hostTarget: "linux-x64",
            commandRunner,
            packageCommandRunner: packageRunner,
            writeStdout: () => {},
            writeStderr: (text) => {
              stderr.push(text)
            }
          })

          const report = decodeReproDiffJsonError(stderr.join(""))
          expect(exitCode).toBe(1)
          expect(report.tag).toBe("ReproDiffError")
          expect(report.report.differences[0]?.firstDifferenceOffset).toBe(4)
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      })
    ),
  CLI_REPRO_TEST_TIMEOUT_MS
)

test(
  "desktop check --repro rejects target drift between passes",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-target-"))
        )
        try {
          const buildRoot = join(directory, "build")
          const packageRoot = join(directory, "package")
          yield* Effect.promise(() => mkdir(buildRoot, { recursive: true }))
          yield* Effect.promise(() => mkdir(packageRoot, { recursive: true }))
          yield* Effect.promise(() => writeFile(join(buildRoot, "app.txt"), "identical\n"))
          yield* Effect.promise(() => writeFile(join(packageRoot, "app.deb"), "identical\n"))
          let pass = 0

          const exit = yield* Effect.exit(
            runDesktopReproCheck({
              buildRunner: () =>
                Effect.sync(() => {
                  pass += 1
                  return {
                    target: pass === 1 ? "linux-x64" : "macos-arm64",
                    layoutPath: buildRoot
                  }
                }),
              packageRunner: () =>
                Effect.gen(function* () {
                  yield* Effect.tryPromise({
                    try: () => mkdir(packageRoot, { recursive: true }),
                    catch: toTryPromiseError
                  })
                  yield* Effect.tryPromise({
                    try: () => writeFile(join(packageRoot, "app.deb"), "identical\n"),
                    catch: toTryPromiseError
                  })
                  return {
                    outputPath: packageRoot
                  }
                })
            })
          )

          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            const failReason = exit.cause.reasons.find((reason) => reason._tag === "Fail")
            const error = failReason?.error as
              | {
                  readonly _tag?: string
                  readonly report?: {
                    readonly passed: boolean
                    readonly differences: readonly [
                      {
                        readonly kind: string
                        readonly firstTarget?: string
                        readonly secondTarget?: string
                      }
                    ]
                  }
                }
              | undefined
            expect(error).toBeDefined()
            if (error === undefined) {
              throw new Error("expected repro diff error")
            }
            expect(error._tag).toBe("ReproDiffError")
            expect(error.report?.passed).toBe(false)
            expect(error.report?.differences[0]?.kind).toBe("target")
            expect(error.report?.differences[0]?.firstTarget).toBe("linux-x64")
            expect(error.report?.differences[0]?.secondTarget).toBe("macos-arm64")
          }
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      })
    ),
  CLI_REPRO_TEST_TIMEOUT_MS
)

const reproSymlinkTest = process.platform === "win32" ? test.skip : test

reproSymlinkTest(
  "desktop check --repro reports entry-type drift between symlink and regular file",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
        )
        try {
          yield* writePlaygroundFixture(directory)
          const commandRunner = deterministicBuildRunner()
          let pass = 0
          const packageRunner = symlinkDriftPackageRunner(() => {
            pass += 1
            return pass === 1 ? "symlink" : "regular"
          })
          const stderr: string[] = []

          const exitCode = yield* runCli({
            argv: [
              "check",
              "--repro",
              "--config",
              "apps/inspector/desktop.config.ts",
              "--platform",
              "linux-x64",
              "--artifact",
              "deb",
              "--json"
            ],
            cwd: directory,
            hostTarget: "linux-x64",
            commandRunner,
            packageCommandRunner: packageRunner,
            writeStdout: () => {},
            writeStderr: (text) => {
              stderr.push(text)
            }
          })

          const report = decodeReproDiffJsonError(stderr.join(""))
          expect(exitCode).toBe(1)
          expect(report.tag).toBe("ReproDiffError")
          const drift = report.report.differences.find((difference) =>
            difference.relativePath.endsWith("app-link")
          )
          expect(drift?.kind).toBe("entry-type")
          expect(drift?.firstEntryKind).toBe("symlink")
          expect(drift?.secondEntryKind).toBe("file")
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      })
    ),
  CLI_REPRO_TEST_TIMEOUT_MS
)

reproSymlinkTest(
  "desktop check --repro reports symlink-target drift between two symlinks",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
        )
        try {
          yield* writePlaygroundFixture(directory)
          const commandRunner = deterministicBuildRunner()
          let pass = 0
          const packageRunner = symlinkDriftPackageRunner(() => {
            pass += 1
            return pass === 1 ? "symlink-a" : "symlink-b"
          })
          const stderr: string[] = []

          const exitCode = yield* runCli({
            argv: [
              "check",
              "--repro",
              "--config",
              "apps/inspector/desktop.config.ts",
              "--platform",
              "linux-x64",
              "--artifact",
              "deb",
              "--json"
            ],
            cwd: directory,
            hostTarget: "linux-x64",
            commandRunner,
            packageCommandRunner: packageRunner,
            writeStdout: () => {},
            writeStderr: (text) => {
              stderr.push(text)
            }
          })

          const report = decodeReproDiffJsonError(stderr.join(""))
          expect(exitCode).toBe(1)
          expect(report.tag).toBe("ReproDiffError")
          const drift = report.report.differences.find((difference) =>
            difference.relativePath.endsWith("app-link")
          )
          expect(drift?.kind).toBe("symlink-target")
          expect(drift?.firstSymlinkTarget).toBe("target-a.txt")
          expect(drift?.secondSymlinkTarget).toBe("target-b.txt")
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      })
    ),
  CLI_REPRO_TEST_TIMEOUT_MS
)

reproSymlinkTest(
  "desktop check --repro passes when both passes emit identical symlinks",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
        )
        try {
          yield* writePlaygroundFixture(directory)
          const commandRunner = deterministicBuildRunner()
          const packageRunner = symlinkDriftPackageRunner(() => "symlink")
          const stdout: string[] = []

          const exitCode = yield* runCli({
            argv: [
              "check",
              "--repro",
              "--config",
              "apps/inspector/desktop.config.ts",
              "--platform",
              "linux-x64",
              "--artifact",
              "deb"
            ],
            cwd: directory,
            hostTarget: "linux-x64",
            commandRunner,
            packageCommandRunner: packageRunner,
            writeStdout: (text) => {
              stdout.push(text)
            },
            writeStderr: () => {}
          })

          expect(exitCode).toBe(0)
          expect(stdout.join("")).toContain("byte-identical")
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      })
    ),
  CLI_REPRO_TEST_TIMEOUT_MS
)

const reproModeTest = process.platform === "win32" ? test.skip : test
const packageModeTest = process.platform === "win32" ? test.skip : test

reproModeTest(
  "desktop check --repro reports mode drift between byte-identical files",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
        )
        try {
          yield* writePlaygroundFixture(directory)
          const commandRunner = deterministicBuildRunner()
          let pass = 0
          const packageRunner = modeDriftPackageRunner(() => {
            pass += 1
            return pass === 1 ? 0o755 : 0o644
          })
          const stderr: string[] = []

          const exitCode = yield* runCli({
            argv: [
              "check",
              "--repro",
              "--config",
              "apps/inspector/desktop.config.ts",
              "--platform",
              "linux-x64",
              "--artifact",
              "deb",
              "--json"
            ],
            cwd: directory,
            hostTarget: "linux-x64",
            commandRunner,
            packageCommandRunner: packageRunner,
            writeStdout: () => {},
            writeStderr: (text) => {
              stderr.push(text)
            }
          })

          const report = decodeReproDiffJsonError(stderr.join(""))
          expect(exitCode).toBe(1)
          expect(report.tag).toBe("ReproDiffError")
          const drift = report.report.differences.find((difference) =>
            difference.relativePath.endsWith("host")
          )
          expect(drift?.kind).toBe("mode")
          expect((drift?.firstMode ?? 0) & 0o111).toBe(0o111)
          expect((drift?.secondMode ?? 0) & 0o111).toBe(0)
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      })
    ),
  CLI_REPRO_TEST_TIMEOUT_MS
)

reproModeTest(
  "desktop check --repro reports mode drift when only read/write bits differ",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
        )
        try {
          yield* writePlaygroundFixture(directory)
          const commandRunner = deterministicBuildRunner()
          let pass = 0
          const packageRunner = modeDriftPackageRunner(() => {
            pass += 1
            return pass === 1 ? 0o644 : 0o444
          })
          const stderr: string[] = []

          const exitCode = yield* runCli({
            argv: [
              "check",
              "--repro",
              "--config",
              "apps/inspector/desktop.config.ts",
              "--platform",
              "linux-x64",
              "--artifact",
              "deb",
              "--json"
            ],
            cwd: directory,
            hostTarget: "linux-x64",
            commandRunner,
            packageCommandRunner: packageRunner,
            writeStdout: () => {},
            writeStderr: (text) => {
              stderr.push(text)
            }
          })

          const report = decodeReproDiffJsonError(stderr.join(""))
          expect(exitCode).toBe(1)
          expect(report.tag).toBe("ReproDiffError")
          const drift = report.report.differences.find((difference) =>
            difference.relativePath.endsWith("host")
          )
          expect(drift?.kind).toBe("mode")
          expect((drift?.firstMode ?? 0) & 0o777).toBe(0o644)
          expect((drift?.secondMode ?? 0) & 0o777).toBe(0o444)
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      })
    ),
  CLI_REPRO_TEST_TIMEOUT_MS
)

reproModeTest(
  "desktop check --repro passes when both passes set the same executable bits",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-"))
        )
        try {
          yield* writePlaygroundFixture(directory)
          const commandRunner = deterministicBuildRunner()
          const packageRunner = modeDriftPackageRunner(() => 0o755)
          const stdout: string[] = []

          const exitCode = yield* runCli({
            argv: [
              "check",
              "--repro",
              "--config",
              "apps/inspector/desktop.config.ts",
              "--platform",
              "linux-x64",
              "--artifact",
              "deb"
            ],
            cwd: directory,
            hostTarget: "linux-x64",
            commandRunner,
            packageCommandRunner: packageRunner,
            writeStdout: (text) => {
              stdout.push(text)
            },
            writeStderr: () => {}
          })

          expect(exitCode).toBe(0)
          expect(stdout.join("")).toContain("byte-identical")
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      })
    ),
  CLI_REPRO_TEST_TIMEOUT_MS
)

test("desktop check --api writes and verifies public API snapshots", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-api-"))
      )
      try {
        yield* writeApiFixturePackage(
          directory,
          "export interface Widget { readonly id: string }\n"
        )
        const writeStdout: string[] = []

        const writeExitCode = yield* runCli({
          argv: ["check", "--api", "--write"],
          cwd: directory,
          writeStdout: (text) => {
            writeStdout.push(text)
          },
          writeStderr: () => {}
        })

        expect(writeExitCode).toBe(0)
        expect(writeStdout.join("")).toContain("mode              write")

        const checkStdout: string[] = []
        const checkExitCode = yield* runCli({
          argv: ["check", "--api"],
          cwd: directory,
          writeStdout: (text) => {
            checkStdout.push(text)
          },
          writeStderr: () => {}
        })

        expect(checkExitCode).toBe(0)
        expect(checkStdout.join("")).toContain("@orika/fixture")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --api rejects snapshots for the wrong package", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-api-"))
      )
      try {
        yield* writeApiFixturePackage(
          directory,
          "export interface Widget { readonly id: string }\n"
        )
        yield* runCli({
          argv: ["check", "--api", "--write"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        const snapshotPath = join(directory, "api", "snapshots", "@orika__fixture.snapshot.json")
        const snapshot = decodeJsonObject(
          yield* Effect.promise(() => readFile(snapshotPath, "utf8"))
        )
        yield* Effect.promise(() =>
          writeFile(
            snapshotPath,
            `${stringifyJson({ ...snapshot, packageName: "@orika/other" }, 2)}\n`
          )
        )

        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["check", "--api", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("PublicApiFileError")
        expect(payload.message).toContain("packageName")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --api ignores non-package directories", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-api-"))
      )
      try {
        yield* writeApiFixturePackage(
          directory,
          "export interface Widget { readonly id: string }\n"
        )
        yield* Effect.promise(() =>
          mkdir(join(directory, "packages", ".cache"), { recursive: true })
        )
        const stdout: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--api", "--write"],
          cwd: directory,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
        expect(stdout.join("")).toContain("@orika/fixture")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --api rejects invalid package names", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-api-"))
      )
      try {
        yield* writeApiFixturePackage(
          directory,
          "export interface Widget { readonly id: string }\n"
        )
        yield* Effect.promise(() =>
          writeFile(
            join(directory, "packages", "fixture", "package.json"),
            stringifyJson(
              {
                name: "../../escape",
                type: "module",
                exports: {
                  ".": {
                    types: "./src/index.ts",
                    default: "./src/index.ts"
                  }
                }
              },
              2
            )
          )
        )
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--api", "--write", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("PublicApiPackageError")
        expect(payload.message).toContain("invalid package name")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --api fails when the public API changes without a snapshot update", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-api-"))
      )
      try {
        yield* writeApiFixturePackage(
          directory,
          "export interface Widget { readonly id: string }\n"
        )
        yield* runCli({
          argv: ["check", "--api", "--write"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        yield* Effect.promise(() =>
          writeFile(
            join(directory, "packages/fixture/src/index.ts"),
            "export interface Widget { readonly id: string }\nexport const added = 1\n"
          )
        )

        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["check", "--api"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("ADD @orika/fixture added")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --api fails when a public signature changes without a snapshot update", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-api-"))
      )
      try {
        yield* writeApiFixturePackage(
          directory,
          "export interface Widget { readonly id: string }\n"
        )
        yield* runCli({
          argv: ["check", "--api", "--write"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        yield* Effect.promise(() =>
          writeFile(
            join(directory, "packages/fixture/src/index.ts"),
            "export interface Widget { readonly id: number }\n"
          )
        )

        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["check", "--api"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("SIGNATURE-CHANGED @orika/fixture Widget")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --api --json reports missing snapshots as typed values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-api-"))
      )
      try {
        yield* writeApiFixturePackage(directory, "export const present = true\n")
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--api", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("PublicApiFileError")
        expect(payload.message).toContain("snapshot")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --docs verifies manifest pages and runnable examples", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-docs-"))
      )
      try {
        yield* writeDocsFixture(directory, {
          "docs/installation.md": [
            "# Installation",
            "",
            "```ts run",
            "const value: string = 'docs'",
            "if (value.length === 0) throw new Error('empty')",
            "```"
          ].join("\n")
        })
        const stdout: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--docs"],
          cwd: directory,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
        expect(stdout.join("")).toContain("pages             1")
        expect(stdout.join("")).toContain("examples          1")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --docs reports missing pages as typed values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-docs-"))
      )
      try {
        yield* writeDocsManifest(directory, [
          { id: "installation", title: "Installation", path: "docs/missing.md" }
        ])
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--docs", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("DocsGateMissingPageError")
        expect(payload.message).toContain("missing.md")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --docs rejects non-string page paths as typed manifest errors", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-docs-"))
      )
      try {
        yield* writeDocsManifest(directory, [
          { id: "installation", title: "Installation", path: 42 }
        ])
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--docs", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("DocsGateManifestError")
        expect(payload.message).toContain("page path")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --docs rejects an incomplete spec manifest even with the required row count", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-docs-"))
      )
      try {
        yield* Effect.promise(() => mkdir(join(directory, "docs"), { recursive: true }))
        yield* Effect.promise(() =>
          writeFile(
            join(directory, "docs", "docs-manifest.json"),
            stringifyJson(
              {
                schemaVersion: 1,
                source: "engineering/SPEC.md §25.3",
                pages: Array.from({ length: 23 }, (_, index) => ({
                  id: `page-${index}`,
                  title: `Page ${index}`,
                  path: `docs/page-${index}.md`
                }))
              },
              2
            )
          )
        )
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--docs"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("DocsGateManifestError")
        expect(stderr.join("")).toContain("installation")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --docs reports failing runnable examples", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-docs-"))
      )
      try {
        yield* writeDocsFixture(directory, {
          "docs/installation.md": [
            "# Installation",
            "",
            "```ts run",
            "throw new Error('broken docs example')",
            "```"
          ].join("\n")
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--docs"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("DocsGateExampleFailedError")
        expect(stderr.join("")).toContain("installation.md#1")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --docs rejects placeholder examples on required pages", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-docs-"))
      )
      try {
        const sourceManifest = decodeDocsManifestPagesJson(
          yield* Effect.promise(() =>
            readFile(join(REPO_ROOT, "docs", "docs-manifest.json"), "utf8")
          )
        )
        yield* writeDocsManifest(directory, sourceManifest.pages, "engineering/SPEC.md §25.3")
        const coverageTokens = [
          "runCli",
          "ReactDesktop",
          "Desktop",
          "defineDesktopConfig",
          "WindowRpcs",
          "RpcGroup",
          "HostProtocolEnvelope",
          "ClipboardRpcs",
          "ResourceRegistry",
          "Process",
          "PTY",
          "MemoryFilesystem",
          "Settings",
          "PermissionRegistry",
          "CommandRegistry",
          "DevtoolsShell",
          "runHeadless",
          "runDesktopPackage",
          "runDesktopSign",
          "runDesktopPublish",
          "DoctorMissing",
          "runSemverGuard",
          "runDocsReleaseGate"
        ].join(" ")
        for (const page of sourceManifest.pages) {
          const body =
            page.id === "filesystem"
              ? [
                  "# Filesystem",
                  "",
                  "```ts run",
                  "import { CliUsageError } from '../packages/cli/src/index.js'",
                  "new CliUsageError('docs')",
                  "```"
                ].join("\n")
              : [
                  "# Page",
                  "",
                  "```ts run",
                  `const coverage = ${stringifyJson(coverageTokens)}`,
                  "void coverage",
                  "```"
                ].join("\n")
          yield* Effect.promise(() =>
            mkdir(dirname(join(directory, page.path)), { recursive: true })
          )
          yield* Effect.promise(() => writeFile(join(directory, page.path), body))
        }
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--docs", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("DocsGateCoverageError")
        expect(payload.message).toContain("docs/filesystem.md")
        expect(payload.message).toContain("MemoryFilesystem")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test(
  "desktop check --docs times out hanging runnable examples",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-docs-"))
        )
        try {
          yield* writeDocsFixture(directory, {
            "docs/installation.md": [
              "# Installation",
              "",
              "```ts run",
              "await new Promise(() => {})",
              "```"
            ].join("\n")
          })
          const hangingRunner: DocsExampleRunner = () => Effect.never

          const exit = yield* Effect.exit(
            runDocsReleaseGate({
              cwd: directory,
              commandRunner: hangingRunner,
              exampleTimeoutMillis: 10
            })
          )

          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            const failReason = exit.cause.reasons.find((reason) => reason._tag === "Fail")
            expect(failReason?.error._tag).toBe("DocsGateExampleFailedError")
            expect(failReason?.error.message).toContain("timed out")
            expect(failReason?.error.message).toContain("installation.md#1")
          }
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      })
    ),
  CLI_DOCS_TIMEOUT_TEST_TIMEOUT_MS
)

test("desktop check --docs rejects manifest paths outside the repo", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-docs-"))
      )
      try {
        yield* writeDocsManifest(directory, [
          { id: "escape", title: "Escape", path: "../outside.md" }
        ])

        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["check", "--docs", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        const payload = decodeCliJsonError(stderr.join(""))
        expect(payload.tag).toBe("DocsGateManifestError")
        expect(payload.message).toContain("escapes the repo")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --docs rejects absolute manifest paths", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-docs-"))
      )
      try {
        yield* writeDocsManifest(directory, [
          { id: "absolute", title: "Absolute", path: "/etc/passwd" }
        ])

        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["check", "--docs", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        const payload = decodeCliJsonError(stderr.join(""))
        expect(payload.tag).toBe("DocsGateManifestError")
        expect(payload.message).toContain("escapes the repo")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --release verifies the release supply-chain posture", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
      )
      try {
        yield* writeReleaseFixture(directory)
        const stdout: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--release"],
          cwd: directory,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
        expect(stdout.join("")).toContain("gates             8")
        expect(stdout.join("")).toContain("spdx-sbom")
        expect(stdout.join("")).toContain("branch-protection")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --release rejects incomplete spec gate identities", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
      )
      try {
        yield* writeReleaseFixture(directory, {
          checklist: {
            schemaVersion: 1,
            source: "engineering/SPEC.md §25.4",
            subjects: [
              {
                id: "inspector",
                configPath: "apps/inspector/desktop.config.ts",
                distDir: "apps/inspector/dist",
                requiredCommands: [
                  "bun packages/cli/src/bin.ts build --config apps/inspector/desktop.config.ts"
                ]
              }
            ],
            gates: Array.from({ length: 8 }, (_, index) => ({
              id: `gate-${index}`,
              title: `Gate ${index}`,
              kind: "workflow-step",
              evidence: [".github/workflows/release.yml#Gate"]
            }))
          }
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--release", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("ReleaseGateManifestError")
        expect(payload.message).toContain("unknown")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --release rejects malformed checklist shape", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
      )
      try {
        yield* writeReleaseFixture(directory, {
          checklist: {
            schemaVersion: 1,
            source: "engineering/SPEC.md §25.4"
          }
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--release", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("ReleaseGateManifestError")
        expect(payload.message).toContain("gates")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --release verifies configured non-inspector subjects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
      )
      try {
        const checklist = releaseChecklistFixture()
        if (!isReleaseChecklistFixture(checklist)) {
          throw new Error("invalid release checklist fixture")
        }
        yield* writeReleaseFixture(directory, {
          checklist: {
            ...checklist,
            subjects: [
              ...checklist.subjects,
              {
                id: "basic-template",
                configPath: "apps/fixture-a11y/desktop.config.ts",
                distDir: "apps/fixture-a11y/dist",
                requiredCommands: [
                  "bun packages/cli/src/bin.ts build --config apps/fixture-a11y/desktop.config.ts",
                  "bun packages/cli/src/bin.ts package --config apps/fixture-a11y/desktop.config.ts",
                  "bun packages/cli/src/bin.ts check --repro --config apps/fixture-a11y/desktop.config.ts"
                ]
              }
            ]
          },
          releaseWorkflow: [
            releaseWorkflowFixture(),
            "      - name: Build basic template",
            "        run: bun packages/cli/src/bin.ts build --config apps/fixture-a11y/desktop.config.ts",
            "      - name: Package basic template",
            "        run: bun packages/cli/src/bin.ts package --config apps/fixture-a11y/desktop.config.ts",
            "      - name: Repro basic template",
            "        run: bun packages/cli/src/bin.ts check --repro --config apps/fixture-a11y/desktop.config.ts"
          ].join("\n")
        })
        const stdout: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--release"],
          cwd: directory,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
        expect(stdout.join("")).toContain("gates             8")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --release rejects runner-local release signing policy", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
      )
      try {
        yield* writeReleaseFixture(directory, {
          keyManagement: "# Release Key Management\n\nHSM-backed release signing uses rotation.\n"
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--release"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("ReleaseGateEvidenceError")
        expect(stderr.join("")).toContain("runner-local keys are forbidden")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --release rejects unknown evidence sources", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
      )
      try {
        const checklist = releaseChecklistFixture()
        if (!isReleaseChecklistFixture(checklist)) {
          throw new Error("invalid release checklist fixture")
        }
        yield* writeReleaseFixture(directory, {
          checklist: {
            ...checklist,
            gates: checklist.gates.map((gate) =>
              gate.id === "spdx-sbom"
                ? { ...gate, evidence: ["engineering/security/unknown.md#Imaginary Evidence"] }
                : gate
            )
          }
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--release", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("ReleaseGateEvidenceError")
        expect(payload.message).toContain("unsupported evidence")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --release rejects empty evidence anchors", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
      )
      try {
        const checklist = releaseChecklistFixture()
        if (!isReleaseChecklistFixture(checklist)) {
          throw new Error("invalid release checklist fixture")
        }
        yield* writeReleaseFixture(directory, {
          checklist: {
            ...checklist,
            gates: checklist.gates.map((gate) =>
              gate.id === "spdx-sbom"
                ? { ...gate, evidence: [".github/workflows/release.yml#"] }
                : gate
            )
          }
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--release", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("ReleaseGateEvidenceError")
        expect(payload.message).toContain("empty evidence anchor")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --release rejects evidence from another gate", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
      )
      try {
        const checklist = releaseChecklistFixture()
        if (!isReleaseChecklistFixture(checklist)) {
          throw new Error("invalid release checklist fixture")
        }
        yield* writeReleaseFixture(directory, {
          checklist: {
            ...checklist,
            gates: checklist.gates.map((gate) =>
              gate.id === "secret-scanning"
                ? {
                    ...gate,
                    evidence: ["engineering/security/release-settings.md#GitHub-hosted runners"]
                  }
                : gate
            )
          }
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--release", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("ReleaseGateEvidenceError")
        expect(payload.message).toContain("does not accept evidence")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --release rejects stale workflow evidence in the checklist", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
      )
      try {
        const checklist = releaseChecklistFixture()
        if (!isReleaseChecklistFixture(checklist)) {
          throw new Error("invalid release checklist fixture")
        }
        yield* writeReleaseFixture(directory, {
          checklist: {
            ...checklist,
            gates: checklist.gates.map((gate) =>
              gate.id === "spdx-sbom"
                ? { ...gate, evidence: [".github/workflows/release.yml#Missing SBOM Step"] }
                : gate
            )
          }
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--release"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("ReleaseGateEvidenceError")
        expect(stderr.join("")).toContain("Missing SBOM Step")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --release rejects unpinned release workflow actions", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
      )
      try {
        yield* writeReleaseFixture(directory, {
          releaseWorkflow: releaseWorkflowFixture().replace(
            "actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26 # v4.1.0",
            "actions/attest@v4"
          )
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--release"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("ReleaseGateEvidenceError")
        expect(stderr.join("")).toContain("unpinned or uncommented action reference")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --release ignores uses text inside run scripts", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
      )
      try {
        yield* writeReleaseFixture(directory, {
          releaseWorkflow: [
            releaseWorkflowFixture(),
            "      - name: Document action syntax",
            "        run: |",
            "          # uses: actions/checkout@v6",
            "          echo done"
          ].join("\n")
        })
        const stdout: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--release"],
          cwd: directory,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
        expect(stdout.join("")).toContain("gates             8")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --release rejects subject package before build", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
      )
      try {
        yield* writeReleaseFixture(directory, {
          releaseWorkflow: releaseWorkflowFixture().replace(
            [
              "      - name: Build desktop app",
              "        run: bun packages/cli/src/bin.ts build --config apps/inspector/desktop.config.ts",
              "      - name: Package release artifact",
              "        run: bun packages/cli/src/bin.ts package --config apps/inspector/desktop.config.ts"
            ].join("\n"),
            [
              "      - name: Package release artifact",
              "        run: bun packages/cli/src/bin.ts package --config apps/inspector/desktop.config.ts",
              "      - name: Build desktop app",
              "        run: bun packages/cli/src/bin.ts build --config apps/inspector/desktop.config.ts"
            ].join("\n")
          )
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--release", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("ReleaseGateEvidenceError")
        expect(payload.message).toContain("release subject inspector")
        expect(payload.message).toContain("build --config apps/inspector/desktop.config.ts")
        expect(payload.message).toContain("before")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --release reports missing subject workflow command", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
      )
      try {
        const checklist = releaseChecklistFixture()
        if (!isReleaseChecklistFixture(checklist)) {
          throw new Error("invalid release checklist fixture")
        }
        yield* writeReleaseFixture(directory, {
          checklist: {
            ...checklist,
            subjects: [
              {
                id: "basic-template",
                configPath: "apps/fixture-a11y/desktop.config.ts",
                distDir: "apps/fixture-a11y/dist",
                requiredCommands: [
                  "bun packages/cli/src/bin.ts build --config apps/fixture-a11y/desktop.config.ts"
                ]
              }
            ]
          }
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--release", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("ReleaseGateEvidenceError")
        expect(payload.message).toContain("release subject basic-template")
        expect(payload.message).toContain(
          "bun packages/cli/src/bin.ts build --config apps/fixture-a11y/desktop.config.ts"
        )
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --release rejects empty CVSS exemption sections", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-release-"))
      )
      try {
        yield* writeReleaseFixture(directory)
        yield* Effect.promise(() =>
          mkdir(join(directory, "engineering", "security", "exemptions"), { recursive: true })
        )
        yield* Effect.promise(() =>
          writeFile(
            join(directory, "engineering", "security", "exemptions", "empty.md"),
            ["# Empty exemption", "", "## Justification", "", "## Re-review", ""].join("\n")
          )
        )
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--release", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("ReleaseGateEvidenceError")
        expect(payload.message).toContain("non-empty Justification")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --a11y verifies template accessibility evidence", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
      )
      try {
        yield* writeAccessibilityFixture(directory)
        const stdout: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--a11y"],
          cwd: directory,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
        expect(stdout.join("")).toContain("templates         1")
        expect(stdout.join("")).toContain("fixture-a11y")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --a11y rejects hardcoded template English outside i18n files", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
      )
      try {
        yield* writeAccessibilityFixture(directory, {
          appSource: [
            "import { templateMessages } from './messages'",
            "export function App() {",
            "  return <button>Open window</button>",
            "}"
          ].join("\n")
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--a11y"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("AccessibilityGateEvidenceError")
        expect(stderr.join("")).toContain("hardcoded user-visible English")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --a11y rejects single-word hardcoded template labels", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
      )
      try {
        yield* writeAccessibilityFixture(directory, {
          appSource: [
            "import { templateMessages } from './messages'",
            "export function App() {",
            "  return <button>Settings</button>",
            "}"
          ].join("\n")
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--a11y"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("AccessibilityGateEvidenceError")
        expect(stderr.join("")).toContain("Settings")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --a11y rejects zero-pass axe reports", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
      )
      try {
        yield* writeAccessibilityFixture(directory, {
          axePasses: []
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--a11y", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("AccessibilityGateEvidenceError")
        expect(payload.message).toContain("no axe pass evidence")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --a11y rejects comment-only required tokens", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
      )
      try {
        yield* writeAccessibilityFixture(directory, {
          styles: [
            "/* prefers-color-scheme */",
            "/* prefers-reduced-motion */",
            ":root { color-scheme: light; }"
          ].join("\n")
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--a11y", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("AccessibilityGateEvidenceError")
        expect(payload.message).toContain("prefers-reduced-motion")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --a11y binds RTL audit modes to Arabic rendered state", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
      )
      try {
        yield* writeAccessibilityFixture(directory, {
          axeUrlForMode: (mode) =>
            mode.endsWith("rtl")
              ? `fixture:${mode}?dir=rtl&color-scheme=${mode.startsWith("dark") ? "dark" : "light"}`
              : defaultAxeUrlForMode(mode)
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--a11y", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("AccessibilityGateEvidenceError")
        expect(payload.message).toContain("rtl")
        expect(payload.message).toContain("rendered template state")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --a11y rejects missing manifest template arrays", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
      )
      try {
        yield* writeAccessibilityFixture(directory, {
          manifest: {
            schemaVersion: 1,
            source: "engineering/SPEC.md §25.5",
            release: "v1.0.0"
          }
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--a11y", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("AccessibilityGateManifestError")
        expect(payload.message).toContain("templates")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --a11y binds audit mode IDs to semantics", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
      )
      try {
        const manifest = accessibilityManifestFixture()
        if (!isAccessibilityManifestFixture(manifest)) {
          throw new Error("invalid accessibility manifest fixture")
        }
        yield* writeAccessibilityFixture(directory, {
          manifest: {
            ...manifest,
            templates: manifest.templates.map((template) => ({
              ...template,
              auditModes: template.auditModes.map((mode) =>
                mode.id === "light-ltr" ? { ...mode, direction: "rtl" } : mode
              )
            }))
          }
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--a11y", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("AccessibilityGateEvidenceError")
        expect(payload.message).toContain("light-ltr direction")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --a11y binds Pa11y audit files to modes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
      )
      try {
        yield* writeAccessibilityFixture(directory, {
          pa11yUrlForMode: () => defaultAxeUrlForMode("light-ltr")
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--a11y", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("AccessibilityGateEvidenceError")
        expect(payload.message).toContain("pa11y.dark-ltr.json")
        expect(payload.message).toContain("rendered template state")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --a11y rejects contrast below the WCAG floor", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
      )
      try {
        const manifest = accessibilityManifestFixture()
        if (!isAccessibilityManifestFixture(manifest)) {
          throw new Error("invalid accessibility manifest fixture")
        }
        yield* writeAccessibilityFixture(directory, {
          manifest: {
            ...manifest,
            templates: manifest.templates.map((template) => ({
              ...template,
              contrastPairs: [
                {
                  id: "bad-body",
                  foreground: "#777777",
                  background: "#888888",
                  minimumRatio: 4.5
                }
              ]
            }))
          }
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--a11y"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("AccessibilityGateEvidenceError")
        expect(stderr.join("")).toContain("contrast ratio")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --a11y rejects invalid contrast colors", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
      )
      try {
        const manifest = accessibilityManifestFixture()
        if (!isAccessibilityManifestFixture(manifest)) {
          throw new Error("invalid accessibility manifest fixture")
        }
        yield* writeAccessibilityFixture(directory, {
          manifest: {
            ...manifest,
            templates: manifest.templates.map((template) => ({
              ...template,
              contrastPairs: [
                {
                  id: "bad-color",
                  foreground: "not-a-color",
                  background: "#ffffff",
                  minimumRatio: 4.5
                }
              ]
            }))
          }
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--a11y", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("AccessibilityGateEvidenceError")
        expect(payload.message).toContain("foreground")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --a11y rejects invalid contrast minimums", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
      )
      try {
        const manifest = accessibilityManifestFixture()
        if (!isAccessibilityManifestFixture(manifest)) {
          throw new Error("invalid accessibility manifest fixture")
        }
        yield* writeAccessibilityFixture(directory, {
          manifest: {
            ...manifest,
            templates: manifest.templates.map((template) => ({
              ...template,
              contrastPairs: [
                {
                  id: "bad-minimum",
                  foreground: "#020617",
                  background: "#f8fafc",
                  minimumRatio: -1
                }
              ]
            }))
          }
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--a11y", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("AccessibilityGateEvidenceError")
        expect(payload.message).toContain("minimumRatio")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --a11y rejects paths outside the workspace", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
      )
      try {
        const manifest = accessibilityManifestFixture()
        if (!isAccessibilityManifestFixture(manifest)) {
          throw new Error("invalid accessibility manifest fixture")
        }
        yield* writeAccessibilityFixture(directory, {
          manifest: {
            ...manifest,
            templates: manifest.templates.map((template) => ({
              ...template,
              requiredTokens: [{ file: "../outside-token.txt", token: "resolveTemplateLocale" }]
            }))
          }
        })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--a11y", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("AccessibilityGateEvidenceError")
        expect(payload.message).toContain("must stay inside")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop check --a11y rejects screencast directories", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-a11y-"))
      )
      try {
        yield* writeAccessibilityFixture(directory)
        const screencastPath = join(
          directory,
          "engineering",
          "audits",
          "v1.0.0",
          "fixture-a11y",
          "keyboard-walkthrough.webm"
        )
        yield* Effect.promise(() => rm(screencastPath))
        yield* Effect.promise(() => mkdir(screencastPath))
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["check", "--a11y", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("AccessibilityGateEvidenceError")
        expect(payload.message).toContain("screencast file")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("semver guard verifies additive release posture", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
      )
      try {
        yield* writeSemverFixture(directory, { packageVersion: "1.1.0" })
        const report = yield* runSemverGuard({
          cwd: directory,
          publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
        })

        expect(report.passed).toBe(true)
        expect(report.appendixCRows).toHaveLength(4)
        expect(report.packageVersions.map((pkg) => pkg.version)).toEqual(["1.1.0"])
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("semver guard rejects package version drift from the release manifest", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
      )
      try {
        yield* writeSemverFixture(directory, { packageVersion: "0.0.0" })
        const error = yield* runSemverGuard({
          cwd: directory,
          publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
        }).pipe(Effect.flip)

        expect((error as { readonly _tag: string })._tag).toBe("SemverGuardManifestError")
        expect((error as { readonly message: string }).message).toContain("@orika/core@0.0.0")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("semver guard rejects manifest with missing bridgeEnvelopePolicy", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
      )
      try {
        const manifest = semverManifestFixture()
        if (!isSemverManifestFixture(manifest)) {
          throw new Error("invalid semver manifest fixture")
        }
        yield* writeSemverFixture(directory, {
          packageVersion: "1.1.0",
          manifest: { ...manifest, bridgeEnvelopePolicy: undefined }
        })
        const error = yield* runSemverGuard({
          cwd: directory,
          publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
        }).pipe(Effect.flip)

        expect((error as { readonly _tag: string })._tag).toBe("SemverGuardManifestError")
        expect((error as { readonly message: string }).message).toContain("bridgeEnvelopePolicy")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("semver guard passes manifest publicApiSnapshots to the API checker", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
      )
      try {
        const manifest = semverManifestFixture()
        if (!isSemverManifestFixture(manifest)) {
          throw new Error("invalid semver manifest fixture")
        }
        yield* writeSemverFixture(directory, {
          packageVersion: "1.1.0",
          manifest: { ...manifest, publicApiSnapshots: "api/custom-snapshots" }
        })
        let observedSnapshotRoot = ""

        yield* runSemverGuard({
          cwd: directory,
          publicApiCheck: (_cwd, snapshotRoot) => {
            observedSnapshotRoot = snapshotRoot
            return Effect.succeed(publicApiReportFixture("added"))
          }
        })

        expect(observedSnapshotRoot).toBe("api/custom-snapshots")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("semver guard rejects escaping publicApiSnapshots roots", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
      )
      try {
        const manifest = semverManifestFixture()
        if (!isSemverManifestFixture(manifest)) {
          throw new Error("invalid semver manifest fixture")
        }
        yield* writeSemverFixture(directory, {
          packageVersion: "1.1.0",
          manifest: { ...manifest, publicApiSnapshots: "../api/snapshots" }
        })

        const error = yield* runSemverGuard({
          cwd: directory,
          publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
        }).pipe(Effect.flip)

        expect((error as { readonly _tag: string })._tag).toBe("SemverGuardManifestError")
        expect((error as { readonly message: string }).message).toContain("publicApiSnapshots")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("semver guard rejects empty public API snapshot paths", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
      )
      try {
        const manifest = semverManifestFixture()
        if (!isSemverManifestFixture(manifest)) {
          throw new Error("invalid semver manifest fixture")
        }
        yield* writeSemverFixture(directory, {
          packageVersion: "1.1.0",
          manifest: { ...manifest, publicApiSnapshots: "" }
        })

        const error = yield* runSemverGuard({
          cwd: directory,
          publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
        }).pipe(Effect.flip)

        expect((error as { readonly _tag: string })._tag).toBe("SemverGuardManifestError")
        expect((error as { readonly message: string }).message).toContain("publicApiSnapshots")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("semver guard rejects verification matrices outside the repo", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
      )
      const outsideDirectory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-outside-"))
      )
      try {
        const manifest = semverManifestFixture()
        if (!isSemverManifestFixture(manifest)) {
          throw new Error("invalid semver manifest fixture")
        }
        const outsideMatrix = join(outsideDirectory, "verification-matrix.json")
        yield* Effect.promise(() =>
          writeFile(outsideMatrix, stringifyJson(semverMatrixFixture(), 2))
        )
        yield* writeSemverFixture(directory, {
          packageVersion: "1.1.0",
          manifest: {
            ...manifest,
            verificationMatrix: relative(directory, outsideMatrix)
          }
        })

        const error = yield* runSemverGuard({
          cwd: directory,
          publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
        }).pipe(Effect.flip)

        expect((error as { readonly _tag: string })._tag).toBe("SemverGuardManifestError")
        expect((error as { readonly message: string }).message).toContain("verificationMatrix")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        yield* Effect.promise(() => rm(outsideDirectory, { recursive: true, force: true }))
      }
    })
  ))

test("semver guard rejects missing Appendix C rows", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
      )
      try {
        const manifest = semverManifestFixture()
        if (!isSemverManifestFixture(manifest)) {
          throw new Error("invalid semver manifest fixture")
        }
        yield* writeSemverFixture(directory, {
          packageVersion: "1.1.0",
          manifest: { ...manifest, appendixCRows: ["C.54", "C.404"] }
        })
        const exit = yield* Effect.exit(
          runSemverGuard({
            cwd: directory,
            publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
          })
        )

        expect(exit._tag).toBe("Failure")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("semver guard rejects malformed Appendix C matrix coverage", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly label: string
        readonly manifestPatch?: Record<string, unknown>
        readonly matrix: unknown
      }> = [
        {
          label: "empty rows",
          manifestPatch: { appendixCRows: [] },
          matrix: semverMatrixFixture()
        },
        { label: "missing rows", matrix: { ...semverMatrixFixture(), rows: undefined } },
        { label: "array rows", matrix: { ...semverMatrixFixture(), rows: [] } },
        { label: "string rows", matrix: { ...semverMatrixFixture(), rows: "not rows" } }
      ]

      for (const testCase of cases) {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), `effect-desktop-cli-semver-${testCase.label}-`))
        )
        try {
          const manifest = semverManifestFixture()
          if (!isSemverManifestFixture(manifest)) {
            throw new Error("invalid semver manifest fixture")
          }
          yield* writeSemverFixture(directory, {
            packageVersion: "1.1.0",
            manifest: { ...manifest, ...testCase.manifestPatch },
            matrix: testCase.matrix
          })

          const error = yield* runSemverGuard({
            cwd: directory,
            publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
          }).pipe(Effect.flip)

          expect((error as { readonly _tag: string })._tag).toBe("SemverGuardManifestError")
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      }
    })
  ))

test("semver guard rejects weakened semver policy fields", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly label: string
        readonly manifestPatch: Record<string, unknown>
      }> = [
        {
          label: "deprecated-jsdoc-disabled",
          manifestPatch: {
            deprecationPolicy: {
              minimumMinorReleases: 3,
              requiresJSDocDeprecated: false
            }
          }
        },
        {
          label: "empty-bridge-allowed-change",
          manifestPatch: {
            bridgeEnvelopePolicy: {
              source: "engineering/SPEC.md §9.3",
              frozenBetweenMajors: true,
              allowedChange: ""
            }
          }
        },
        {
          label: "permissive-bridge-allowed-change",
          manifestPatch: {
            bridgeEnvelopePolicy: {
              source: "engineering/SPEC.md §9.3",
              frozenBetweenMajors: true,
              allowedChange: "anything may change between minor releases"
            }
          }
        }
      ]

      for (const testCase of cases) {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), `effect-desktop-cli-semver-${testCase.label}-`))
        )
        try {
          const manifest = semverManifestFixture()
          if (!isSemverManifestFixture(manifest)) {
            throw new Error("invalid semver manifest fixture")
          }
          yield* writeSemverFixture(directory, {
            packageVersion: "1.1.0",
            manifest: { ...manifest, ...testCase.manifestPatch }
          })

          const error = yield* runSemverGuard({
            cwd: directory,
            publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
          }).pipe(Effect.flip)

          expect((error as { readonly _tag: string })._tag).toBe("SemverGuardManifestError")
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      }
    })
  ))

test("semver guard allows additive public API changes and blocks removals", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
      )
      try {
        yield* writeSemverFixture(directory, { packageVersion: "1.1.0" })
        const additive = yield* runSemverGuard({
          cwd: directory,
          publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
        })

        expect(additive.passed).toBe(true)

        const removalExit = yield* Effect.exit(
          runSemverGuard({
            cwd: directory,
            publicApiCheck: () => Effect.succeed(publicApiReportFixture("removed"))
          })
        )
        expect(removalExit._tag).toBe("Failure")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("semver guard rejects additive public API changes in patch releases", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
      )
      try {
        const manifest = semverManifestFixture()
        if (!isSemverManifestFixture(manifest)) {
          throw new Error("invalid semver manifest fixture")
        }
        yield* writeSemverFixture(directory, {
          packageVersion: "1.1.1",
          manifest: { ...manifest, release: "1.1.1", releaseKind: "patch" }
        })

        const exit = yield* Effect.exit(
          runSemverGuard({
            cwd: directory,
            publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
          })
        )

        expect(exit._tag).toBe("Failure")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("semver guard rejects release kind drift from the semantic version", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
      )
      try {
        const manifest = semverManifestFixture()
        if (!isSemverManifestFixture(manifest)) {
          throw new Error("invalid semver manifest fixture")
        }
        yield* writeSemverFixture(directory, {
          packageVersion: "1.1.1",
          manifest: { ...manifest, release: "1.1.1", releaseKind: "minor" }
        })

        const exit = yield* Effect.exit(
          runSemverGuard({
            cwd: directory,
            publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
          })
        )

        expect(exit._tag).toBe("Failure")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("semver guard rejects padded release versions", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
      )
      try {
        const manifest = semverManifestFixture()
        if (!isSemverManifestFixture(manifest)) {
          throw new Error("invalid semver manifest fixture")
        }
        yield* writeSemverFixture(directory, {
          packageVersion: "01.02.03",
          manifest: { ...manifest, release: "01.02.03", releaseKind: "patch" }
        })

        const exit = yield* Effect.exit(
          runSemverGuard({
            cwd: directory,
            publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
          })
        )

        expect(exit._tag).toBe("Failure")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("semver guard rejects wrong-typed manifest fields", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-semver-"))
      )
      try {
        const manifest = semverManifestFixture()
        if (!isSemverManifestFixture(manifest)) {
          throw new Error("invalid semver manifest fixture")
        }
        yield* writeSemverFixture(directory, {
          manifest: {
            ...manifest,
            deprecationPolicy: {
              ...manifest.deprecationPolicy,
              minimumMinorReleases: "3"
            }
          }
        })

        const exit = yield* Effect.exit(
          runSemverGuard({
            cwd: directory,
            publicApiCheck: () => Effect.succeed(publicApiReportFixture("added"))
          })
        )

        expect(exit._tag).toBe("Failure")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop sign signs macOS app bundle with hardened runtime entitlements", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: {
            macos: { identity: "Developer ID Application: Example Inc.", teamId: "ABCD1234" }
          },
          permissions: ["device.camera", "network.client"]
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "app")
        const calls: string[] = []
        const runner: SignCommandRunner = (invocation) => {
          calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
          return Effect.void
        }

        const stdout: string[] = []
        const exitCode = yield* runCli({
          argv: ["sign", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "macos-arm64",
          now: fixedClock([100, 125, 200, 230, 300, 330, 400, 430]),
          signCommandRunner: runner,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        const outputRoot = join(directory, "apps", "inspector", "dist", "desktop", "macos")
        const artifactRoot = join(outputRoot, "ORIKA-Playground-0.0.0-macos-arm64")
        const entitlements = yield* Effect.promise(() =>
          readFile(join(artifactRoot, "effect-desktop-entitlements.plist"), "utf8")
        )
        const report = decodeSignReportJson(
          yield* Effect.promise(() => readFile(join(outputRoot, "sign-report.json"), "utf8"))
        )

        expect(exitCode).toBe(0)
        expect(stdout.join("")).toContain("ORIKA sign")
        expect(entitlements).toContain("<key>com.apple.security.cs.allow-jit</key>")
        expect(entitlements).toContain("<key>com.apple.security.device.camera</key>\n  <true/>")
        expect(entitlements).toContain(
          "<key>com.apple.security.device.microphone</key>\n  <false/>"
        )
        expect(entitlements).toContain("<key>com.apple.security.network.client</key>\n  <true/>")
        expect(calls.at(-1)).toContain(
          "codesign --force --sign Developer ID Application: Example Inc."
        )
        expect(calls.at(-1)).toContain("--options runtime --entitlements")
        expect(report.artifacts[0]?.signedPaths).toHaveLength(4)
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop sign rejects malformed permission entries before macOS codesign", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: {
            macos: { identity: "Developer ID Application: Example Inc.", teamId: "ABCD1234" }
          },
          permissions: [42]
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "app")
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["sign", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          hostTarget: "macos-arm64",
          signCommandRunner: () => Effect.die("codesign must not run with malformed permissions"),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const error = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(error.tag).toBe("SignConfigError")
        expect(error.message).toContain("permissions[0]")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop sign fails macOS signing without a Developer ID identity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "app")
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["sign", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          hostTarget: "macos-arm64",
          signCommandRunner: () => Effect.die("sign runner should not run without identity"),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const error = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(error.tag).toBe("SignConfigError")
        expect(error.message).toContain("signing.macos.identity")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop sign Authenticode-signs Windows MSI with RFC 3161 timestamp", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: {
            windows: {
              thumbprint: "A1B2C3D4E5F60718293A4B5C6D7E8F9012345678",
              timestampUrl: "http://timestamp.digicert.com"
            }
          }
        })
        yield* writePackagedArtifactFixture(directory, "windows-x64", "msi")
        const calls: string[] = []
        const runner: SignCommandRunner = (invocation) => {
          calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
          return Effect.void
        }

        const exitCode = yield* runCli({
          argv: ["sign", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "windows-x64",
          signCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
        expect(calls[0]).toContain("windows-unblock:powershell")
        expect(calls[0]).toContain("Unblock-File")
        expect(calls[1]).toContain("windows-authenticode:signtool sign /fd SHA256")
        expect(calls[1]).toContain(
          "/tr http://timestamp.digicert.com /td SHA256 /sha1 A1B2C3D4E5F60718293A4B5C6D7E8F9012345678"
        )
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop sign rejects invalid Windows timestamp URLs before signtool", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: {
            windows: {
              thumbprint: "A1B2C3D4E5F60718293A4B5C6D7E8F9012345678",
              timestampUrl: "not a url"
            }
          }
        })
        yield* writePackagedArtifactFixture(directory, "windows-x64", "msi")
        const calls: string[] = []
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["sign", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          hostTarget: "windows-x64",
          signCommandRunner: (invocation) =>
            Effect.sync(() => {
              calls.push(invocation.step)
            }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const error = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(calls).toEqual([])
        expect(error.tag).toBe("SignConfigError")
        expect(error.message).toContain("signing.windows.timestampUrl")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop sign rejects malformed Windows certificate thumbprints", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: {
            windows: { thumbprint: "not-a-sha1", timestampUrl: "http://timestamp.digicert.com" }
          }
        })
        yield* writePackagedArtifactFixture(directory, "windows-x64", "msi")
        const calls: string[] = []
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["sign", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          hostTarget: "windows-x64",
          signCommandRunner: (invocation) =>
            Effect.sync(() => {
              calls.push(invocation.step)
            }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const error = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(calls).toEqual([])
        expect(error.tag).toBe("SignConfigError")
        expect(error.message).toContain("signing.windows.thumbprint")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop sign resolves Windows PFX password env without recording the secret", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-"))
      )
      const previousPassword = yield* Effect.sync(() =>
        readTestEnv("EFFECT_DESKTOP_TEST_PFX_PASSWORD")
      )
      try {
        yield* Effect.sync(() =>
          writeTestEnv("EFFECT_DESKTOP_TEST_PFX_PASSWORD", "secret-password")
        )
        yield* writePlaygroundFixture(directory, {
          signing: {
            windows: {
              pfx: { path: "certs/release.pfx", passwordEnv: "EFFECT_DESKTOP_TEST_PFX_PASSWORD" }
            }
          }
        })
        yield* writePackagedArtifactFixture(directory, "windows-x64", "msi")
        let signArgs: readonly string[] = []
        const runner: SignCommandRunner = (invocation) => {
          if (invocation.step === "windows-authenticode") {
            signArgs = invocation.args
          }
          return Effect.void
        }

        const exitCode = yield* runCli({
          argv: ["sign", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "windows-x64",
          signCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        const report = yield* Effect.promise(() =>
          readFile(
            join(directory, "apps", "inspector", "dist", "desktop", "windows", "sign-report.json"),
            "utf8"
          )
        )

        expect(exitCode).toBe(0)
        expect(signArgs).toContain("secret-password")
        expect(report).toContain("<redacted:WindowsPfxPassword>")
        expect(report).not.toContain("secret-password")
      } finally {
        if (previousPassword === undefined) {
          yield* Effect.sync(() => writeTestEnv("EFFECT_DESKTOP_TEST_PFX_PASSWORD", undefined))
        } else {
          yield* Effect.sync(() =>
            writeTestEnv("EFFECT_DESKTOP_TEST_PFX_PASSWORD", previousPassword)
          )
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop sign GPG-signs Linux AppImage and writes Linux metadata", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-"))
      )
      try {
        yield* writePlaygroundFixture(directory, { signing: { linux: { gpgKey: "ABCD1234" } } })
        const artifactPath = yield* writePackagedArtifactFixture(directory, "linux-x64", "appimage")
        const calls: string[] = []
        const runner: SignCommandRunner = (invocation) =>
          Effect.gen(function* () {
            calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
            const outputPath = invocation.args[invocation.args.indexOf("--output") + 1]
            if (typeof outputPath === "string") {
              yield* runSignFixtureIo(invocation, () => writeFile(outputPath, "signature"))
            }
          })

        const stdout: string[] = []
        const exitCode = yield* runCli({
          argv: ["sign", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          signCommandRunner: runner,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        const artifactRoot = dirname(artifactPath)
        const metainfo = yield* Effect.promise(() =>
          readFile(
            join(artifactRoot, "share", "metainfo", "dev.effect-desktop.inspector.metainfo.xml"),
            "utf8"
          )
        )
        const desktop = yield* Effect.promise(() =>
          readFile(
            join(artifactRoot, "share", "applications", "dev.effect-desktop.inspector.desktop"),
            "utf8"
          )
        )

        expect(exitCode).toBe(0)
        expect(stdout.join("")).toContain("appimage")
        expect(calls[0]).toContain("linux-gpg:gpg --batch --yes --armor --detach-sign")
        expect(calls[0]).toContain("--local-user ABCD1234")
        expect(yield* Effect.promise(() => readFile(`${artifactPath}.asc`, "utf8"))).toBe(
          "signature"
        )
        expect(metainfo).toContain("<id>dev.effect-desktop.inspector</id>")
        expect(metainfo).toContain(
          '<launchable type="desktop-id">dev.effect-desktop.inspector.desktop</launchable>'
        )
        expect(desktop).toContain("Name=ORIKA Playground")
        expect(desktop).toContain("Exec=dev.effect-desktop.inspector")
        expect(desktop).toContain("Icon=dev.effect-desktop.inspector")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop sign rejects tampered package artifacts before signing", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-tampered-"))
      )
      try {
        yield* writePlaygroundFixture(directory, { signing: { linux: { gpgKey: "ABCD1234" } } })
        const artifactPath = yield* writePackagedArtifactFixture(directory, "linux-x64", "appimage")
        yield* Effect.promise(() => writeFile(artifactPath, "tampered"))
        const calls: string[] = []
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["sign", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          signCommandRunner: (invocation) =>
            Effect.sync(() => {
              calls.push(invocation.step)
            }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(calls).toEqual([])
        expect(stderr.join("")).toContain("SignFileError")
        expect(stderr.join("")).toContain("does not match package artifact metadata")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop sign rejects Linux signable artifacts without linuxIntegration metadata", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-no-linux-int-"))
      )
      try {
        yield* writePlaygroundFixture(directory, { signing: { linux: { gpgKey: "ABCD1234" } } })
        const artifactPath = yield* writePackagedArtifactFixture(directory, "linux-x64", "appimage")
        const artifactRoot = dirname(artifactPath)
        const artifactJsonPath = join(artifactRoot, "artifact.json")
        const artifactJson = {
          ...decodeJsonObject(yield* Effect.promise(() => readFile(artifactJsonPath, "utf8")))
        }
        delete artifactJson["linuxIntegration"]
        yield* Effect.promise(() =>
          writeFile(artifactJsonPath, `${stringifyJson(artifactJson, 2)}\n`)
        )
        const calls: string[] = []
        const runner: SignCommandRunner = (invocation) => {
          calls.push(invocation.step)
          return Effect.die("signing commands must not run when linuxIntegration is missing")
        }
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["sign", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          signCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(calls).toEqual([])
        expect(stderr.join("")).toContain("SignConfigError")
        expect(stderr.join("")).toContain("linuxIntegration")
        yield* expectEffectPromiseRejects(stat(`${artifactPath}.asc`))
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop sign rejects artifact fileName that escapes the metadata directory", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidFileNames = [
        "../outside.AppImage",
        "/tmp/outside.AppImage",
        ".",
        "..",
        "nested/artifact.AppImage",
        "nested\\artifact.AppImage"
      ] as const

      for (const fileName of invalidFileNames) {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-traversal-"))
        )
        try {
          yield* writePlaygroundFixture(directory, { signing: { linux: { gpgKey: "ABCD1234" } } })
          const artifactPath = yield* writePackagedArtifactFixture(
            directory,
            "linux-x64",
            "appimage"
          )
          const artifactRoot = dirname(artifactPath)
          const linuxDir = dirname(artifactRoot)
          const outsideName = "outside.AppImage"
          const outsidePath = join(linuxDir, outsideName)
          yield* Effect.promise(() => writeFile(outsidePath, "outside artifact bytes"))
          yield* Effect.promise(() =>
            writeFile(
              join(artifactRoot, "artifact.json"),
              `${stringifyJson(
                {
                  appId: "dev.effect-desktop.inspector",
                  appName: "ORIKA Playground",
                  appVersion: "0.0.0",
                  kind: "appimage",
                  target: "linux-x64",
                  fileName,
                  sizeBytes: 0,
                  sha256: "0".repeat(64)
                },
                2
              )}\n`
            )
          )
          const calls: string[] = []
          const runner: SignCommandRunner = (invocation) =>
            Effect.gen(function* () {
              calls.push(invocation.step)
              const outputPath = invocation.args[invocation.args.indexOf("--output") + 1]
              if (typeof outputPath === "string") {
                yield* runSignFixtureIo(invocation, () => writeFile(outputPath, "signature"))
              }
            })
          const stderr: string[] = []
          const exitCode = yield* runCli({
            argv: ["sign", "--config", "apps/inspector/desktop.config.ts"],
            cwd: directory,
            hostTarget: "linux-x64",
            signCommandRunner: runner,
            writeStdout: () => {},
            writeStderr: (text) => {
              stderr.push(text)
            }
          })

          expect(exitCode).toBe(1)
          expect(stderr.join("")).toContain("SignConfigError")
          expect(stderr.join("")).toContain("#fileName")
          expect(calls).toEqual([])
          yield* expectEffectPromiseRejects(stat(`${outsidePath}.asc`))
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      }
    })
  ))

test("desktop sign rejects path-shaped app.id before writing Linux sidecars", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-id-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          app: {
            id: "../../../../escaped",
            name: "ORIKA Playground",
            version: "0.0.0"
          }
        })
        const artifactPath = yield* writePackagedArtifactFixture(directory, "linux-x64", "appimage")
        const artifactRoot = dirname(artifactPath)
        const calls: string[] = []
        const runner: SignCommandRunner = (invocation) => {
          calls.push(invocation.step)
          return Effect.void
        }
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["sign", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          signCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const escapedDesktop = join(dirname(artifactRoot), "escaped.desktop")
        const escapedMetainfo = join(dirname(artifactRoot), "escaped.metainfo.xml")

        expect(exitCode).toBe(1)
        expect(calls).toEqual([])
        expect(stderr.join("")).toContain("SignConfigError")
        expect(stderr.join("")).toContain("app.id must be a reverse-DNS ASCII identifier")
        yield* expectEffectPromiseRejects(stat(escapedDesktop))
        yield* expectEffectPromiseRejects(stat(escapedMetainfo))
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop sign skips artifacts whose metadata target does not match the requested target", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-target-mismatch-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: {
            macos: { identity: "Developer ID Application: Example Inc.", teamId: "ABCD1234" }
          }
        })
        const artifactPath = yield* writePackagedArtifactFixture(directory, "macos-arm64", "app")
        const artifactJsonPath = join(dirname(artifactPath), "artifact.json")
        const artifactJson = {
          ...decodeJsonObject(yield* Effect.promise(() => readFile(artifactJsonPath, "utf8")))
        }
        artifactJson["target"] = "linux-x64"
        yield* Effect.promise(() =>
          writeFile(artifactJsonPath, `${stringifyJson(artifactJson, 2)}\n`)
        )

        const calls: string[] = []
        const runner: SignCommandRunner = (invocation) => {
          calls.push(invocation.step)
          return Effect.void
        }

        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["sign", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          hostTarget: "macos-arm64",
          signCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const error = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(calls).toEqual([])
        expect(error.tag).toBe("SignFileError")
        expect(error.message).toContain("no macos packaged artifacts found")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop sign rejects stale artifacts from a different app identity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-sign-identity-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          app: { id: "dev.effect-desktop.other", name: "Other App", version: "0.0.0" },
          signing: { linux: { gpgKey: "ABCD1234" } }
        })
        yield* writePackagedArtifactFixture(directory, "linux-x64", "appimage")
        const calls: string[] = []
        const runner: SignCommandRunner = (invocation) => {
          calls.push(invocation.step)
          return Effect.void
        }
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["sign", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          signCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(calls).toEqual([])
        expect(stderr.join("")).toContain("SignConfigError")
        expect(stderr.join("")).toContain("artifact.json#appId")
        expect(stderr.join("")).toContain("dev.effect-desktop.inspector")
        expect(stderr.join("")).toContain("active app.id dev.effect-desktop.other")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop notarize skips artifacts whose metadata target does not match the requested target", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-target-mismatch-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
        })
        const artifactPath = yield* writePackagedArtifactFixture(directory, "macos-arm64", "app")
        const artifactJsonPath = join(dirname(artifactPath), "artifact.json")
        const artifactJson = {
          ...decodeJsonObject(yield* Effect.promise(() => readFile(artifactJsonPath, "utf8")))
        }
        artifactJson["target"] = "macos-x64"
        yield* Effect.promise(() =>
          writeFile(artifactJsonPath, `${stringifyJson(artifactJson, 2)}\n`)
        )

        const calls: string[] = []
        const runner: NotarizeCommandRunner = (invocation) => {
          calls.push(invocation.step)
          return Effect.succeed({ stdout: "", stderr: "", exitCode: 0 })
        }

        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["notarize", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          hostTarget: "macos-arm64",
          notarizeCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const error = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(calls).toEqual([])
        expect(error.tag).toBe("NotarizeFileError")
        expect(error.message).toContain("no directly notarizable macOS artifacts found")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop notarize rejects stale artifacts from a different app identity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-identity-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          app: { id: "dev.effect-desktop.other", name: "Other App", version: "0.0.0" },
          signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "app")
        const calls: string[] = []
        const runner: NotarizeCommandRunner = (invocation) => {
          calls.push(invocation.step)
          return Effect.succeed({ stdout: `${invocation.step} ok`, stderr: "", exitCode: 0 })
        }
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["notarize", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          hostTarget: "macos-arm64",
          notarizeCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const error = decodeCliJsonError(stderr.join(""))

        expect(exitCode).toBe(1)
        expect(calls).toEqual([])
        expect(error.tag).toBe("NotarizeConfigError")
        expect(error.message).toContain("artifact.json#appId")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop notarize submits staples and assesses unstapled macOS artifacts", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
        })
        const appPath = yield* writePackagedArtifactFixture(directory, "macos-arm64", "app")
        const calls: string[] = []
        const runner: NotarizeCommandRunner = (invocation) => {
          calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
          if (invocation.step === "stapler-validate") {
            return Effect.succeed({ stdout: "", stderr: "ticket not found", exitCode: 65 })
          }
          if (invocation.step === "notarytool-submit") {
            return Effect.succeed({
              stdout: stringifyJson({ id: "submission-1", status: "Accepted" }),
              stderr: "",
              exitCode: 0
            })
          }
          return Effect.succeed({ stdout: `${invocation.step} ok`, stderr: "", exitCode: 0 })
        }

        const stdout: string[] = []
        const exitCode = yield* runCli({
          argv: ["notarize", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "macos-arm64",
          now: fixedClock([100, 110, 200, 220, 300, 330, 400, 440]),
          notarizeCommandRunner: runner,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        const report = decodeNotarizeArtifactsReportJson(
          yield* Effect.promise(() =>
            readFile(
              join(
                directory,
                "apps",
                "inspector",
                "dist",
                "desktop",
                "macos",
                "notarize-report.json"
              ),
              "utf8"
            )
          )
        )

        expect(exitCode).toBe(0)
        expect(stdout.join("")).toContain("ORIKA notarize")
        expect(calls).toEqual([
          `stapler-validate:xcrun stapler validate ${appPath}`,
          `notarytool-submit:xcrun notarytool submit ${appPath} --wait --output-format json --keychain-profile release-profile`,
          `stapler-staple:xcrun stapler staple ${appPath}`,
          `spctl-assess:spctl --assess --type execute --verbose=4 ${appPath}`
        ])
        expect(report.artifacts[0]?.submissionId).toBe("submission-1")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop notarize rejects tampered package artifacts before submission", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-tampered-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
        })
        const appPath = yield* writePackagedArtifactFixture(directory, "macos-arm64", "app")
        yield* Effect.promise(() =>
          writeFile(join(appPath, "Contents", "MacOS", "ORIKA-Playground"), "tampered")
        )
        const calls: string[] = []
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["notarize", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "macos-arm64",
          notarizeCommandRunner: (invocation) =>
            Effect.sync(() => {
              calls.push(invocation.step)
              return { stdout: "", stderr: "", exitCode: 0 }
            }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(calls).toEqual([])
        expect(stderr.join("")).toContain("NotarizeFileError")
        expect(stderr.join("")).toContain("does not match package artifact metadata")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop notarize is a no-op submit when staple validation already passes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
        const calls: string[] = []
        const runner: NotarizeCommandRunner = (invocation) => {
          calls.push(invocation.step)
          return Effect.succeed({ stdout: `${invocation.step} ok`, stderr: "", exitCode: 0 })
        }

        const exitCode = yield* runCli({
          argv: ["notarize", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "macos-arm64",
          notarizeCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
        expect(calls).toEqual(["stapler-validate", "spctl-assess"])
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop notarize assesses DMG artifacts as disk images", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-dmg-spctl-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
        })
        const dmgPath = yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
        const calls: string[] = []
        const runner: NotarizeCommandRunner = (invocation) => {
          calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
          return Effect.succeed({ stdout: `${invocation.step} ok`, stderr: "", exitCode: 0 })
        }

        const exitCode = yield* runCli({
          argv: ["notarize", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "macos-arm64",
          notarizeCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
        expect(calls).toContain(
          `spctl-assess:spctl --assess --type open --context context:primary-signature --verbose=4 ${dmgPath}`
        )
        expect(calls.some((call) => call.includes("--type execute"))).toBe(false)
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop notarize rejects artifact file names outside the metadata directory", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidFileNames = [
        "../outside.dmg",
        "/tmp/outside.dmg",
        ".",
        "..",
        "nested/artifact.dmg",
        "nested\\artifact.dmg",
        "file:artifact.dmg",
        "artifact\u0000.dmg"
      ] as const

      for (const fileName of invalidFileNames) {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-containment-"))
        )
        try {
          yield* writePlaygroundFixture(directory, {
            signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
          })
          const outputRoot = join(directory, "apps", "inspector", "dist", "desktop", "macos")
          const artifactRoot = join(outputRoot, "artifact-root")
          yield* Effect.promise(() => mkdir(artifactRoot, { recursive: true }))
          yield* Effect.promise(() =>
            writeFile(join(outputRoot, "outside.dmg"), "outside artifact bytes")
          )
          yield* Effect.promise(() =>
            writeFile(
              join(artifactRoot, "artifact.json"),
              `${stringifyJson(
                {
                  appId: "dev.effect-desktop.inspector",
                  appName: "ORIKA Playground",
                  appVersion: "0.0.0",
                  kind: "dmg",
                  target: "macos-arm64",
                  fileName
                },
                2
              )}\n`
            )
          )
          const calls: string[] = []
          const stderr: string[] = []
          const runner: NotarizeCommandRunner = (invocation) => {
            calls.push(invocation.step)
            return Effect.die("notarization commands should not run for invalid artifact metadata")
          }

          const exitCode = yield* runCli({
            argv: ["notarize", "--config", "apps/inspector/desktop.config.ts"],
            cwd: directory,
            hostTarget: "macos-arm64",
            notarizeCommandRunner: runner,
            writeStdout: () => {},
            writeStderr: (text) => {
              stderr.push(text)
            }
          })

          expect(exitCode).toBe(1)
          expect(calls).toEqual([])
          expect(stderr.join("")).toContain("NotarizeConfigError")
          expect(stderr.join("")).toContain("artifact-root")
          expect(stderr.join("")).toContain("artifact.json#fileName")
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      }
    })
  ))

test("desktop notarize accepts contained artifact file names with consecutive dots", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-dotted-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
        })
        const outputRoot = join(directory, "apps", "inspector", "dist", "desktop", "macos")
        const artifactRoot = join(outputRoot, "artifact-root")
        const fileName = "Effect..Desktop-0.0.0-macos-arm64.dmg"
        const artifactPath = join(artifactRoot, fileName)
        yield* Effect.promise(() => mkdir(artifactRoot, { recursive: true }))
        yield* Effect.promise(() => writeFile(artifactPath, "dmg"))
        const digest = yield* digestArtifactFixture(artifactPath)
        yield* Effect.promise(() =>
          writeFile(
            join(artifactRoot, "artifact.json"),
            `${stringifyJson(
              {
                appId: "dev.effect-desktop.inspector",
                appName: "ORIKA Playground",
                appVersion: "0.0.0",
                kind: "dmg",
                target: "macos-arm64",
                fileName,
                ...digest
              },
              2
            )}\n`
          )
        )
        const calls: string[] = []
        const runner: NotarizeCommandRunner = (invocation) => {
          calls.push(invocation.step)
          return Effect.succeed({ stdout: `${invocation.step} ok`, stderr: "", exitCode: 0 })
        }

        const exitCode = yield* runCli({
          argv: ["notarize", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "macos-arm64",
          notarizeCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
        expect(calls).toEqual(["stapler-validate", "spctl-assess"])
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop notarize ignores zip sidecars that stapler cannot staple", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "zip")
        const calls: string[] = []
        const runner: NotarizeCommandRunner = (invocation) => {
          calls.push(invocation.step)
          return Effect.succeed({ stdout: `${invocation.step} ok`, stderr: "", exitCode: 0 })
        }

        const exitCode = yield* runCli({
          argv: ["notarize", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "macos-arm64",
          notarizeCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        const report = decodeNotarizeArtifactsReportJson(
          yield* Effect.promise(() =>
            readFile(
              join(
                directory,
                "apps",
                "inspector",
                "dist",
                "desktop",
                "macos",
                "notarize-report.json"
              ),
              "utf8"
            )
          )
        )

        expect(exitCode).toBe(0)
        expect(calls).toEqual(["stapler-validate", "spctl-assess"])
        expect(report.artifacts).toHaveLength(1)
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop notarize redacts Apple ID password credentials in the persisted report", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-"))
      )
      const passwordEnv = "EFFECT_DESKTOP_TEST_NOTARY_PASSWORD"
      const previousPassword = yield* Effect.sync(() => readTestEnv(passwordEnv))
      yield* Effect.sync(() => writeTestEnv(passwordEnv, "real-app-specific-password"))
      try {
        yield* writePlaygroundFixture(directory, {
          signing: {
            macos: {
              teamId: "ABCD1234",
              appleId: "release@example.com",
              passwordEnv
            }
          }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "app")
        const calls: string[] = []
        const runner: NotarizeCommandRunner = (invocation) => {
          calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
          if (invocation.step === "stapler-validate") {
            return Effect.succeed({ stdout: "", stderr: "ticket not found", exitCode: 65 })
          }
          if (invocation.step === "notarytool-submit") {
            return Effect.succeed({
              stdout: stringifyJson({ id: "submission-1", status: "Accepted" }),
              stderr: "",
              exitCode: 0
            })
          }
          return Effect.succeed({ stdout: `${invocation.step} ok`, stderr: "", exitCode: 0 })
        }

        const exitCode = yield* runCli({
          argv: ["notarize", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "macos-arm64",
          notarizeCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        const report = decodeNotarizeStepsReportJson(
          yield* Effect.promise(() =>
            readFile(
              join(
                directory,
                "apps",
                "inspector",
                "dist",
                "desktop",
                "macos",
                "notarize-report.json"
              ),
              "utf8"
            )
          )
        )
        const submitStep = report.steps.find(
          (step) => step.command?.includes("notarytool") === true
        )

        expect(exitCode).toBe(0)
        expect(calls.join("\n")).toContain("--password real-app-specific-password")
        expect(submitStep?.command).toContain("--password")
        expect(submitStep?.command).toContain("<redacted:AppleNotaryPassword>")
        expect(submitStep?.command).not.toContain("real-app-specific-password")
      } finally {
        if (previousPassword === undefined) {
          yield* Effect.sync(() => writeTestEnv(passwordEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(passwordEnv, previousPassword))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop notarize surfaces rejected notarytool output", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "app")
        const stderr: string[] = []
        const runner: NotarizeCommandRunner = (invocation) => {
          if (invocation.step === "stapler-validate") {
            return Effect.succeed({ stdout: "", stderr: "ticket not found", exitCode: 65 })
          }
          if (invocation.step === "notarytool-submit") {
            return Effect.succeed({
              stdout: stringifyJson({ id: "submission-1", status: "Rejected" }),
              stderr: "LogFileURL: https://example.invalid/notary-log.json",
              exitCode: 0
            })
          }
          return Effect.die("staple and assess should not run after rejection")
        }

        const exitCode = yield* runCli({
          argv: ["notarize", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "macos-arm64",
          notarizeCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("notarytool returned Rejected")
        expect(stderr.join("")).toContain("https://example.invalid/notary-log.json")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop notarize returns malformed notarytool JSON as a typed failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-notarize-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          signing: { macos: { teamId: "ABCD1234", notarytoolProfile: "release-profile" } }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "app")
        const stderr: string[] = []
        const runner: NotarizeCommandRunner = (invocation) => {
          if (invocation.step === "stapler-validate") {
            return Effect.succeed({ stdout: "", stderr: "ticket not found", exitCode: 65 })
          }
          if (invocation.step === "notarytool-submit") {
            return Effect.succeed({ stdout: "not json", stderr: "", exitCode: 0 })
          }
          return Effect.die("staple and assess should not run after malformed notarytool JSON")
        }

        const exitCode = yield* runCli({
          argv: ["notarize", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "macos-arm64",
          notarizeCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("failed to parse notarytool JSON output")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish writes a byte-stable Ed25519-signed update manifest", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5,
            minVersion: "0.0.0"
          }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")

        const stdout: string[] = []
        const exitCode = yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        const manifestPath = join(
          directory,
          "apps",
          "inspector",
          "dist",
          "desktop",
          "update-manifest.json"
        )
        const manifest = decodeUpdateManifestJson(
          yield* Effect.promise(() => readFile(manifestPath, "utf8"))
        )
        const report = decodePublishReportJson(stdout.join(""))

        expect(exitCode).toBe(0)
        expect(report.manifestPath).toBe(manifestPath)
        expect(verifyUpdateManifest(manifest, key.publicKey)).toBe(true)
        expect(manifest).toMatchObject({
          schemaVersion: 1,
          appId: "dev.effect-desktop.inspector",
          version: "0.0.0",
          channel: "stable",
          keyVersion: 5,
          publishedAt: "2026-03-07T22:40:00.000Z",
          minVersion: "0.0.0"
        })
        expect(manifest.artifacts).toHaveLength(1)
        expect(manifest.artifacts[0]).toMatchObject({
          platform: "macos-arm64",
          kind: "dmg",
          url: "https://updates.example.invalid/macos-arm64/ORIKA-Playground-0.0.0-macos-arm64.dmg",
          signature: expect.stringContaining("ed25519:")
        })
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish rejects invalid publish timestamps before writing manifests", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidTimestamps = [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        8.64e15 + 1
      ] as const

      for (const timestamp of invalidTimestamps) {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-clock-"))
        )
        const key = testEd25519Key()
        const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
        const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
        yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
        try {
          yield* writePlaygroundFixture(directory, {
            update: {
              channel: "stable",
              feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
              publicKey: key.publicKey,
              privateKeyEnv,
              keyVersion: 5,
              minVersion: "0.0.0"
            }
          })
          yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
          const manifestPath = join(
            directory,
            "apps",
            "inspector",
            "dist",
            "desktop",
            "update-manifest.json"
          )
          const stderr: string[] = []

          const exitCode = yield* runCli({
            argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
            cwd: directory,
            now: () => timestamp,
            writeStdout: () => {},
            writeStderr: (text) => {
              stderr.push(text)
            }
          })

          const payload = decodeCliJsonError(stderr.join(""))
          expect(exitCode).toBe(1)
          expect(payload.tag).toBe("PublishConfigError")
          expect(payload.message).toContain("publish timestamp")
          yield* expectEffectPromiseRejects(readFile(manifestPath, "utf8"))
        } finally {
          if (previousPrivateKey === undefined) {
            yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
          } else {
            yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
          }
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      }
    })
  ))

test("desktop publish canonical bytes ignore object insertion order", () => {
  const manifest = {
    signature: "ed25519:signature",
    version: "1.0.0",
    schemaVersion: 1,
    publishedAt: "2026-05-06T00:00:00.000Z",
    keyVersion: 2,
    channel: "stable",
    artifacts: [
      {
        signature: "ed25519:artifact",
        sha256: "0".repeat(64),
        sizeBytes: 1,
        url: "https://updates.example.invalid/app.dmg",
        kind: "dmg",
        platform: "macos-arm64"
      }
    ],
    appId: "dev.effect-desktop.inspector"
  }
  const reordered = {
    appId: manifest.appId,
    artifacts: manifest.artifacts,
    channel: manifest.channel,
    keyVersion: manifest.keyVersion,
    publishedAt: manifest.publishedAt,
    schemaVersion: manifest.schemaVersion,
    version: manifest.version,
    signature: manifest.signature
  }

  expect(canonicalUpdateManifestBytes(manifest)).toBe(canonicalUpdateManifestBytes(reordered))
})

test("desktop publish encodes artifact URLs for query-string feed URLs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-query-feed-url-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid?platform={platform}&channel={channel}",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5,
            minVersion: "0.0.0"
          }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
        const exitCode = yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        const manifest = decodeUpdateManifestJson(
          yield* Effect.promise(() =>
            readFile(
              join(directory, "apps", "inspector", "dist", "desktop", "update-manifest.json"),
              "utf8"
            )
          )
        )

        expect(exitCode).toBe(0)
        expect(manifest.artifacts[0]).toMatchObject({
          url: "https://updates.example.invalid/ORIKA-Playground-0.0.0-macos-arm64.dmg?platform=macos-arm64&channel=stable"
        })
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish rejects tampered manifest signatures through canonical bytes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5
          }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")

        yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        const manifest = decodeUpdateManifestJson(
          yield* Effect.promise(() =>
            readFile(
              join(directory, "apps", "inspector", "dist", "desktop", "update-manifest.json"),
              "utf8"
            )
          )
        )
        const tampered: UpdateManifest = {
          schemaVersion: manifest.schemaVersion,
          appId: manifest.appId,
          version: "9.9.9",
          channel: manifest.channel,
          keyVersion: manifest.keyVersion,
          publishedAt: manifest.publishedAt,
          ...(manifest.rollback === undefined ? {} : { rollback: manifest.rollback }),
          ...(manifest.minVersion === undefined ? {} : { minVersion: manifest.minVersion }),
          ...(manifest.maxVersion === undefined ? {} : { maxVersion: manifest.maxVersion }),
          artifacts: manifest.artifacts,
          signature: manifest.signature
        }

        expect(verifyUpdateManifest(manifest, key.publicKey)).toBe(true)
        expect(verifyUpdateManifest(tampered, key.publicKey)).toBe(false)
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish rejects stale package metadata before signing the manifest", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5
          }
        })
        const artifactPath = yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
        yield* Effect.promise(() =>
          writeFile(
            join(dirname(artifactPath), "artifact.json"),
            `${stringifyJson(
              {
                appId: "dev.effect-desktop.inspector",
                appName: "ORIKA Playground",
                appVersion: "0.0.0",
                kind: "dmg",
                target: "macos-arm64",
                fileName: "ORIKA-Playground-0.0.0-macos-arm64.dmg",
                sizeBytes: 1,
                sha256: "0".repeat(64)
              },
              2
            )}\n`
          )
        )
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("PublishConfigError")
        expect(stderr.join("")).toContain("package artifact metadata does not match artifact bytes")
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish rejects invalid app ids before writing manifests", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-invalid-appid-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          app: {
            id: "not a reverse dns id",
            name: "ORIKA Playground",
            version: "0.0.0"
          }
        })
        const manifestPath = join(
          directory,
          "apps",
          "inspector",
          "dist",
          "desktop",
          "update-manifest.json"
        )
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const error = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(error.tag).toBe("PublishConfigError")
        expect(error.message).toContain("app.id must be a reverse-DNS ASCII identifier")
        yield* expectEffectPromiseRejects(stat(manifestPath))
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish rejects non-SemVer app versions before writing manifests", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-invalid-version-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          app: {
            id: "dev.effect-desktop.inspector",
            name: "ORIKA Playground",
            version: "not-semver"
          },
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5
          }
        })
        const manifestPath = join(
          directory,
          "apps",
          "inspector",
          "dist",
          "desktop",
          "update-manifest.json"
        )
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const error = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(error.tag).toBe("PublishConfigError")
        expect(error.message).toContain("app.version must be a SemVer X.Y.Z string")
        yield* expectEffectPromiseRejects(stat(manifestPath))
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish rejects invalid feedUrl", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-invalid-feed-url-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          update: {
            channel: "stable",
            feedUrl: "not-a-url-{platform}-{channel}",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5
          }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("update.feedUrl")
        expect(stderr.join("")).toContain("valid http(s) URL template")
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish rejects feedUrl missing the {platform} placeholder", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-feed-no-platform-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid/{channel}.json",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5
          }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("update.feedUrl")
        expect(stderr.join("")).toContain("{platform}")
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish rejects feedUrl missing the {channel} placeholder", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-feed-no-channel-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid/{platform}/stable.json",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5
          }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("update.feedUrl")
        expect(stderr.join("")).toContain("{channel}")
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish rejects stale artifacts from a different app identity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-identity-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          app: { id: "dev.effect-desktop.other", name: "Other App", version: "0.0.0" },
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5
          }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")

        const manifestPath = join(
          directory,
          "apps",
          "inspector",
          "dist",
          "desktop",
          "update-manifest.json"
        )
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const error = decodeCliJsonError(stderr.join(""))

        expect(exitCode).toBe(1)
        expect(error.tag).toBe("PublishConfigError")
        expect(error.message).toContain("artifact.json#appId")
        expect(error.message).toContain("dev.effect-desktop.other")
        yield* expectEffectPromiseRejects(stat(manifestPath))
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish rejects artifact target mismatching platform directory", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-target-mismatch-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5
          }
        })
        const artifactPath = yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
        const artifactJsonPath = join(dirname(artifactPath), "artifact.json")
        const artifactJson = {
          ...decodeJsonObject(yield* Effect.promise(() => readFile(artifactJsonPath, "utf8")))
        }
        artifactJson["target"] = "linux-x64"
        yield* Effect.promise(() =>
          writeFile(artifactJsonPath, `${stringifyJson(artifactJson, 2)}\n`)
        )

        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("does not match platform directory")
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish rejects artifact fileName that escapes the metadata directory", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-traversal-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5
          }
        })
        const artifactPath = yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
        const artifactRoot = dirname(artifactPath)
        const macosDir = dirname(artifactRoot)
        const outsideName = "outside.dmg"
        const outsidePath = join(macosDir, outsideName)
        const outsideBytes = Buffer.from("outside artifact bytes")
        yield* Effect.promise(() => writeFile(outsidePath, outsideBytes))
        yield* Effect.promise(() =>
          writeFile(
            join(artifactRoot, "artifact.json"),
            `${stringifyJson(
              {
                appId: "dev.effect-desktop.inspector",
                appName: "ORIKA Playground",
                appVersion: "0.0.0",
                kind: "dmg",
                target: "macos-arm64",
                fileName: `../${outsideName}`,
                sizeBytes: outsideBytes.byteLength,
                sha256: createHash("sha256").update(outsideBytes).digest("hex")
              },
              2
            )}\n`
          )
        )
        const manifestPath = join(
          directory,
          "apps",
          "inspector",
          "dist",
          "desktop",
          "update-manifest.json"
        )
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("PublishConfigError")
        expect(stderr.join("")).toContain("#fileName")
        yield* expectEffectPromiseRejects(stat(manifestPath))
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish rejects update.minVersion greater than app.version", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-min-version-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          app: {
            id: "dev.effect-desktop.inspector",
            name: "ORIKA Playground",
            version: "1.2.3"
          },
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5,
            minVersion: "9.0.0"
          }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
        const manifestPath = join(
          directory,
          "apps",
          "inspector",
          "dist",
          "desktop",
          "update-manifest.json"
        )
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("update.minVersion")
        expect(stderr.join("")).toContain("must not exceed app.version")
        yield* expectEffectPromiseRejects(stat(manifestPath))
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish rejects rollback manifests without maxVersion", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-rollback-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          app: {
            id: "dev.effect-desktop.inspector",
            name: "ORIKA Playground",
            version: "1.2.3"
          },
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5,
            rollback: true
          }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
        const manifestPath = join(
          directory,
          "apps",
          "inspector",
          "dist",
          "desktop",
          "update-manifest.json"
        )
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("update.maxVersion")
        expect(stderr.join("")).toContain("update.rollback is true")
        yield* expectEffectPromiseRejects(stat(manifestPath))
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish accepts rollback manifests with maxVersion", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-rollback-ok-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          app: {
            id: "dev.effect-desktop.inspector",
            name: "ORIKA Playground",
            version: "1.2.3"
          },
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5,
            rollback: true,
            maxVersion: "2.0.0"
          }
        })
        const artifactPath = yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
        const artifactJsonPath = join(dirname(artifactPath), "artifact.json")
        const artifactJson = {
          ...decodeJsonObject(yield* Effect.promise(() => readFile(artifactJsonPath, "utf8")))
        }
        artifactJson["appVersion"] = "1.2.3"
        yield* Effect.promise(() =>
          writeFile(artifactJsonPath, `${stringifyJson(artifactJson, 2)}\n`)
        )
        const manifestPath = join(
          directory,
          "apps",
          "inspector",
          "dist",
          "desktop",
          "update-manifest.json"
        )
        const exitCode = yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
        const manifest = decodeUpdateManifestJson(
          yield* Effect.promise(() => readFile(manifestPath, "utf8"))
        )
        expect(manifest).toMatchObject({ rollback: true, maxVersion: "2.0.0" })
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish rejects update.publicKey with non-canonical base64", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-key-base64-"))
      )
      const key = testEd25519Key()
      const garbledKey = `${key.publicKey.slice(0, "ed25519:".length + 8)}!!${key.publicKey.slice("ed25519:".length + 10)}`
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
            publicKey: garbledKey,
            privateKeyEnv,
            keyVersion: 5
          }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("PublishConfigError")
        expect(stderr.join("")).toContain("Ed25519 public key")
        expect(stderr.join("")).toContain("canonical base64")
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish accepts update.minVersion equal to app.version", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-min-version-equal-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          app: {
            id: "dev.effect-desktop.inspector",
            name: "ORIKA Playground",
            version: "1.2.3"
          },
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5,
            minVersion: "1.2.3"
          }
        })
        const artifactPath = yield* writePackagedArtifactFixture(directory, "macos-arm64", "dmg")
        const artifactJsonPath = join(dirname(artifactPath), "artifact.json")
        const artifactJson = {
          ...decodeJsonObject(yield* Effect.promise(() => readFile(artifactJsonPath, "utf8")))
        }
        artifactJson["appVersion"] = "1.2.3"
        yield* Effect.promise(() =>
          writeFile(artifactJsonPath, `${stringifyJson(artifactJson, 2)}\n`)
        )
        const exitCode = yield* runCli({
          argv: ["publish", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish signs macOS app directory artifacts with deterministic directory digests", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5
          }
        })
        yield* writePackagedArtifactFixture(directory, "macos-arm64", "app")

        const exitCode = yield* runCli({
          argv: [
            "publish",
            "--config",
            "apps/inspector/desktop.config.ts",
            "--platform",
            "macos-arm64"
          ],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        const manifest = decodeUpdateManifestJson(
          yield* Effect.promise(() =>
            readFile(
              join(directory, "apps", "inspector", "dist", "desktop", "update-manifest.json"),
              "utf8"
            )
          )
        )

        expect(exitCode).toBe(0)
        expect(manifest.artifacts).toHaveLength(1)
        expect(verifyUpdateManifest(manifest, key.publicKey)).toBe(true)
        expect(manifest.artifacts[0]).toMatchObject({
          platform: "macos-arm64",
          kind: "app",
          signature: expect.stringContaining("ed25519:")
        })
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop publish rejects symbolic links inside directory artifacts", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-publish-artifact-link-"))
      )
      const key = testEd25519Key()
      const privateKeyEnv = "EFFECT_DESKTOP_TEST_UPDATE_PRIVATE_KEY"
      const previousPrivateKey = yield* Effect.sync(() => readTestEnv(privateKeyEnv))
      yield* Effect.sync(() => writeTestEnv(privateKeyEnv, key.privateKeyPem))
      try {
        yield* writePlaygroundFixture(directory, {
          update: {
            channel: "stable",
            feedUrl: "https://updates.example.invalid/{platform}/{channel}.json",
            publicKey: key.publicKey,
            privateKeyEnv,
            keyVersion: 5
          }
        })
        const artifactPath = yield* writePackagedArtifactFixture(directory, "macos-arm64", "app")
        const artifactRoot = dirname(artifactPath)
        const externalPayload = join(directory, "external-payload.txt")
        yield* Effect.promise(() => writeFile(externalPayload, "outside artifact bytes"))
        yield* Effect.promise(() =>
          symlink(
            externalPayload,
            join(artifactPath, "Contents", "Resources", "effect-desktop", "runtime", "outside.txt")
          )
        )
        const digest = yield* digestArtifactFixture(artifactPath)
        const artifactJsonPath = join(artifactRoot, "artifact.json")
        const artifactJson = {
          ...decodeJsonObject(yield* Effect.promise(() => readFile(artifactJsonPath, "utf8")))
        }
        artifactJson["sizeBytes"] = digest.sizeBytes
        artifactJson["sha256"] = digest.sha256
        yield* Effect.promise(() =>
          writeFile(artifactJsonPath, `${stringifyJson(artifactJson, 2)}\n`)
        )

        const manifestPath = join(
          directory,
          "apps",
          "inspector",
          "dist",
          "desktop",
          "update-manifest.json"
        )
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: [
            "publish",
            "--config",
            "apps/inspector/desktop.config.ts",
            "--platform",
            "macos-arm64"
          ],
          cwd: directory,
          now: () => 1_772_923_200_000,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("PublishFileError")
        expect(stderr.join("")).toContain("symbolic links")
        yield* expectEffectPromiseRejects(stat(manifestPath))
      } finally {
        if (previousPrivateKey === undefined) {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, undefined))
        } else {
          yield* Effect.sync(() => writeTestEnv(privateKeyEnv, previousPrivateKey))
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build stages renderer runtime host bridge manifests and report", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        const calls: string[] = []
        const nativeHostEmbedEnv: Array<string | undefined> = []
        const runner: CommandRunner = (invocation) =>
          Effect.gen(function* () {
            calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
            if (invocation.step === "native-host") {
              nativeHostEmbedEnv.push(invocation.env?.["EFFECT_DESKTOP_EMBED_DIST"])
            }
            yield* writeBuildFixtureOutput(invocation)
          })

        const stdout: string[] = []
        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          now: fixedClock([100, 125, 200, 260, 300, 305]),
          commandRunner: runner,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        const layout = join(directory, "apps", "inspector", "build", "effect-desktop", "linux-x64")
        const report = decodeJsonObject(
          yield* Effect.promise(() => readFile(join(layout, "build-report.json"), "utf8"))
        )
        const appManifest = decodeJsonObject(
          yield* Effect.promise(() => readFile(join(layout, "app-manifest.json"), "utf8"))
        )
        const bridgeManifest = decodeJsonObject(
          yield* Effect.promise(() =>
            readFile(join(layout, "bridge", "bridge-manifest.json"), "utf8")
          )
        )

        expect(exitCode).toBe(0)
        expect(stdout.join("")).toContain("ORIKA build")
        expect(calls).toEqual([
          "renderer:bun run build",
          `runtime:bun build ${join(directory, "apps", "inspector", "runtime.ts")} --target=bun --outdir ${join(layout, "runtime")}`,
          "native-host:cargo build -p host --release"
        ])
        expect(nativeHostEmbedEnv).toEqual([undefined])
        expect(
          yield* Effect.promise(() => readFile(join(layout, "renderer", "index.html"), "utf8"))
        ).toBe("<h1>ok</h1>")
        expect(
          yield* Effect.promise(() => readFile(join(layout, "runtime", "runtime.js"), "utf8"))
        ).toContain("ok")
        expect(appManifest).toMatchObject({
          hostManifest: {
            webEngine: "system"
          },
          runtimeManifest: {
            engine: "bun",
            entry: "runtime/runtime.js",
            executable: "bun",
            args: ["runtime/runtime.js"],
            env: {}
          }
        })
        const rendererManifest = appManifest["rendererManifest"] as {
          readonly csp: {
            readonly directives: readonly {
              readonly name: string
              readonly values: readonly string[]
            }[]
          }
        }
        expect(rendererManifest.csp.directives.slice(0, 2)).toEqual([
          { name: "default-src", values: ["'self'"] },
          { name: "script-src", values: ["'self'", "'nonce-{N}'"] }
        ])
        expect(yield* Effect.promise(() => readFile(join(layout, "native", "host"), "utf8"))).toBe(
          "host"
        )
        expect(appManifest).toMatchObject({
          id: "dev.effect-desktop.inspector",
          name: "ORIKA Playground",
          target: "linux-x64"
        })
        expect(bridgeManifest).toMatchObject({
          rpcGroups: []
        })
        expect(report).toMatchObject({
          appId: "dev.effect-desktop.inspector",
          target: "linux-x64",
          layoutPath: layout,
          providers: {
            runtime: "bun",
            runtimePackaging: "source",
            webEngine: "system"
          },
          providerBudgets: [
            {
              id: "bun",
              kind: "runtime",
              package: "@effect/platform-bun",
              importPath: "@orika/core/providers/bun",
              startupBudgetMs: 25,
              bundleBudgetKb: 64
            }
          ],
          providerMeasurements: [
            {
              runtimePackaging: "source",
              webEngine: "system",
              target: "linux-x64",
              runtimePayloadBytes: 18,
              runtimeBuildMs: 60,
              startup: {
                runtimeBootMs: null,
                firstWindowVisibleMs: null,
                bridgeReadyMs: null
              },
              checks: [
                {
                  metric: "runtime-payload-bytes",
                  budget: 65_536,
                  actual: 18,
                  status: "pass"
                },
                {
                  metric: "runtime-boot-ms",
                  budget: 25,
                  actual: null,
                  status: "unmeasured"
                }
              ]
            }
          ]
        })
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build emits explicit chrome web engine selection in the host manifest", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-web-engine-"))
      )
      try {
        yield* writePlaygroundFixture(directory, { web: { engine: "chrome" } })
        const chromeRuntime = join(directory, "apps", "inspector", "native", "chrome", "linux-x64")
        yield* Effect.promise(() => mkdir(chromeRuntime, { recursive: true }))
        yield* Effect.promise(() =>
          writeFile(join(chromeRuntime, "cef-runtime.txt"), "pinned test runtime")
        )
        const runner: CommandRunner = (invocation) => writeBuildFixtureOutput(invocation)

        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner: runner,
          writeStdout: () => {},
          writeStderr: () => {}
        }).pipe(
          Effect.provideService(
            Clock.Clock,
            fixedEffectClock([100, 110, 200, 220, 300, 330, 400, 460])
          )
        )

        const manifest = decodeBuildChromeManifestJson(
          yield* Effect.promise(() =>
            readFile(
              join(
                directory,
                "apps",
                "inspector",
                "build",
                "effect-desktop",
                "linux-x64",
                "app-manifest.json"
              ),
              "utf8"
            )
          )
        )
        const report = decodeBuildChromeReportJson(
          yield* Effect.promise(() =>
            readFile(
              join(
                directory,
                "apps",
                "inspector",
                "build",
                "effect-desktop",
                "linux-x64",
                "build-report.json"
              ),
              "utf8"
            )
          )
        )

        expect(exitCode).toBe(0)
        expect(manifest.hostManifest.webEngine).toBe("chrome")
        expect(manifest.hostManifest.webEngineRuntime).toBe("cef")
        expect(manifest.hostManifest.webEnginePath).toBe("native/chrome")
        expect(report.providers.webEngine).toBe("chrome")
        expect(report.providerMeasurements[0]?.webEngine).toBe("chrome")
        expect(report.steps.find((step) => step.name === "native-host")?.provider).toBe(
          "webview:chrome"
        )
        expect(report.steps.find((step) => step.name === "webview-runtime")?.provider).toBe(
          "webview:chrome"
        )
        expect(report.steps.find((step) => step.name === "webview-runtime")?.elapsedMs).toBe(60)
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build rejects chrome web engine when the bundled runtime is absent", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-missing-chrome-"))
      )
      try {
        yield* writePlaygroundFixture(directory, { web: { engine: "chrome" } })
        const calls: string[] = []
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner: (invocation) =>
            Effect.sync(() => {
              calls.push(invocation.step)
            }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(calls).toEqual([])
        expect(stderr.join("")).toContain("BuildConfigError")
        expect(stderr.join("")).toContain("web.engine chrome requires bundled Chromium/CEF assets")
        expect(stderr.join("")).toContain("native/chrome/linux-x64")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build emits node runtime launch manifest for node runtime config", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-node-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          runtime: { engine: "node", entry: "runtime.ts" }
        })
        const calls: string[] = []
        const runner: CommandRunner = (invocation) =>
          Effect.gen(function* () {
            calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
            yield* writeBuildFixtureOutput(invocation)
          })

        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner: runner,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        const layout = join(directory, "apps", "inspector", "build", "effect-desktop", "linux-x64")
        const appManifest = decodeJsonObject(
          yield* Effect.promise(() => readFile(join(layout, "app-manifest.json"), "utf8"))
        )

        expect(exitCode).toBe(0)
        expect(calls).toContain(
          `runtime:bun build ${join(directory, "apps", "inspector", "runtime.ts")} --target=node --outdir ${join(layout, "runtime")}`
        )
        expect(appManifest).toMatchObject({
          runtimeManifest: {
            engine: "node",
            entry: "runtime/runtime.js",
            executable: "node",
            args: ["runtime/runtime.js"],
            env: {}
          }
        })
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build reuses provider-owned nodes when only runtime source changes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-provider-cache-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        const appRoot = join(directory, "apps", "inspector")
        const layout = join(appRoot, "build", "effect-desktop", "linux-x64")
        const calls: string[] = []
        const runner: CommandRunner = (invocation) =>
          Effect.gen(function* () {
            calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
            yield* writeBuildFixtureOutput(invocation, { runtimeJs: "console.log('runtime')\n" })
          })

        const runBuild = () =>
          runCli({
            argv: ["build", "--config", "apps/inspector/desktop.config.ts", "--json"],
            cwd: directory,
            hostTarget: "linux-x64",
            commandRunner: runner,
            writeStdout: () => {},
            writeStderr: () => {}
          })

        expect(yield* runBuild()).toBe(0)
        calls.length = 0
        yield* Effect.promise(() =>
          writeFile(join(appRoot, "runtime.ts"), "console.log('runtime changed')\n")
        )

        expect(yield* runBuild()).toBe(0)

        const report = decodeBuildStepsReportJson(
          yield* Effect.promise(() => readFile(join(layout, "build-report.json"), "utf8"))
        )
        expect(calls).toEqual([
          `runtime:bun build ${join(appRoot, "runtime.ts")} --target=bun --outdir ${join(layout, "runtime")}`
        ])
        expect(report.steps.map((step) => [step.name, step.status, step.provider])).toEqual([
          ["renderer", "reused", "renderer:react"],
          ["runtime", "rebuilt", "runtime:bun"],
          ["native-host", "reused", "webview:system"],
          ["bridge", "reused", undefined],
          ["manifest", "rebuilt", undefined]
        ])
        expect(report.steps.find((step) => step.name === "runtime")?.reason).toContain("cache key")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build invalidates runtime cache when workspace runtime dependencies change", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-runtime-deps-cache-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        const appRoot = join(directory, "apps", "inspector")
        const layout = join(appRoot, "build", "effect-desktop", "linux-x64")
        const frameworkSource = join(directory, "packages", "core", "src", "runtime", "main.ts")
        yield* Effect.promise(() => mkdir(dirname(frameworkSource), { recursive: true }))
        yield* Effect.promise(() =>
          writeFile(frameworkSource, "export const runtimeVersion = 'old'\n")
        )
        const calls: string[] = []
        const runner: CommandRunner = (invocation) =>
          Effect.gen(function* () {
            calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
            yield* writeBuildFixtureOutput(invocation, { runtimeJs: "console.log('runtime')\n" })
          })

        const runBuild = () =>
          runCli({
            argv: ["build", "--config", "apps/inspector/desktop.config.ts", "--json"],
            cwd: directory,
            hostTarget: "linux-x64",
            commandRunner: runner,
            writeStdout: () => {},
            writeStderr: () => {}
          })

        expect(yield* runBuild()).toBe(0)
        calls.length = 0
        yield* Effect.promise(() =>
          writeFile(frameworkSource, "export const runtimeVersion = 'new'\n")
        )

        expect(yield* runBuild()).toBe(0)

        const report = decodeBuildStepsReportJson(
          yield* Effect.promise(() => readFile(join(layout, "build-report.json"), "utf8"))
        )
        expect(calls).toEqual([
          `runtime:bun build ${join(appRoot, "runtime.ts")} --target=bun --outdir ${join(layout, "runtime")}`
        ])
        expect(report.steps.map((step) => [step.name, step.status, step.provider])).toEqual([
          ["renderer", "reused", "renderer:react"],
          ["runtime", "rebuilt", "runtime:bun"],
          ["native-host", "reused", "webview:system"],
          ["bridge", "reused", undefined],
          ["manifest", "rebuilt", undefined]
        ])
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build reuses native host when only renderer source changes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-renderer-cache-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        const appRoot = join(directory, "apps", "inspector")
        const layout = join(appRoot, "build", "effect-desktop", "linux-x64")
        const calls: string[] = []
        const runner: CommandRunner = (invocation) =>
          Effect.gen(function* () {
            calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
            yield* writeBuildFixtureOutput(invocation, {
              rendererHtml: "<h1>renderer</h1>",
              runtimeJs: "console.log('runtime')\n"
            })
          })

        const runBuild = () =>
          runCli({
            argv: ["build", "--config", "apps/inspector/desktop.config.ts", "--json"],
            cwd: directory,
            hostTarget: "linux-x64",
            commandRunner: runner,
            writeStdout: () => {},
            writeStderr: () => {}
          })

        expect(yield* runBuild()).toBe(0)
        calls.length = 0
        yield* Effect.promise(() =>
          writeFile(join(appRoot, "src", "renderer", "main.tsx"), "console.log('changed')\n")
        )

        expect(yield* runBuild()).toBe(0)

        const report = decodeBuildStepsReportJson(
          yield* Effect.promise(() => readFile(join(layout, "build-report.json"), "utf8"))
        )
        expect(calls).toEqual(["renderer:bun run build"])
        expect(report.steps.map((step) => [step.name, step.status, step.provider])).toEqual([
          ["renderer", "rebuilt", "renderer:react"],
          ["runtime", "reused", "runtime:bun"],
          ["native-host", "reused", "webview:system"],
          ["bridge", "reused", undefined],
          ["manifest", "rebuilt", undefined]
        ])
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build ignores malformed build cache and rebuilds nodes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-invalid-cache-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        const appRoot = join(directory, "apps", "inspector")
        const layout = join(appRoot, "build", "effect-desktop", "linux-x64")
        const calls: string[] = []
        const runner: CommandRunner = (invocation) =>
          Effect.gen(function* () {
            calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
            yield* writeBuildFixtureOutput(invocation, {
              rendererHtml: "<h1>renderer</h1>",
              runtimeJs: "console.log('runtime')\n"
            })
          })

        const runBuild = () =>
          runCli({
            argv: ["build", "--config", "apps/inspector/desktop.config.ts", "--json"],
            cwd: directory,
            hostTarget: "linux-x64",
            commandRunner: runner,
            writeStdout: () => {},
            writeStderr: () => {}
          })

        expect(yield* runBuild()).toBe(0)
        calls.length = 0
        yield* Effect.promise(() => writeFile(join(layout, ".build-cache.json"), "{bad json"))

        expect(yield* runBuild()).toBe(0)

        const report = decodeBuildStepsReportJson(
          yield* Effect.promise(() => readFile(join(layout, "build-report.json"), "utf8"))
        )
        expect(calls).toEqual([
          "renderer:bun run build",
          `runtime:bun build ${join(appRoot, "runtime.ts")} --target=bun --outdir ${join(layout, "runtime")}`,
          "native-host:cargo build -p host --release"
        ])
        expect(report.steps.map((step) => [step.name, step.status])).toEqual([
          ["renderer", "rebuilt"],
          ["runtime", "rebuilt"],
          ["native-host", "rebuilt"],
          ["bridge", "rebuilt"],
          ["manifest", "rebuilt"]
        ])
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build reports unreadable build cache before running build steps", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-unreadable-cache-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        const appRoot = join(directory, "apps", "inspector")
        const layout = join(appRoot, "build", "effect-desktop", "linux-x64")
        const calls: string[] = []
        const stderr: string[] = []
        const runner: CommandRunner = (invocation) =>
          Effect.gen(function* () {
            calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
            yield* writeBuildFixtureOutput(invocation, {
              rendererHtml: "<h1>renderer</h1>",
              runtimeJs: "console.log('runtime')\n"
            })
          })

        const runBuild = () =>
          runCli({
            argv: ["build", "--config", "apps/inspector/desktop.config.ts", "--json"],
            cwd: directory,
            hostTarget: "linux-x64",
            commandRunner: runner,
            writeStdout: () => {},
            writeStderr: (text) => {
              stderr.push(text)
            }
          })

        expect(yield* runBuild()).toBe(0)
        calls.length = 0
        stderr.length = 0
        yield* Effect.promise(() => rm(join(layout, ".build-cache.json"), { force: true }))
        yield* Effect.promise(() => mkdir(join(layout, ".build-cache.json")))

        expect(yield* runBuild()).toBe(1)

        expect(calls).toEqual([])
        expect(stderr.join("")).toContain("failed to read")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build preserves renderer stderr on command failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-stderr-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        const appRoot = join(directory, "apps", "inspector")
        yield* Effect.promise(() =>
          writeFile(
            join(appRoot, "package.json"),
            '{"type":"module","scripts":{"build":"bun fail-renderer.ts"}}\n'
          )
        )
        yield* Effect.promise(() =>
          writeFile(
            join(appRoot, "fail-renderer.ts"),
            "console.error('renderer dependency missing: @types/node'); process.exit(1)\n"
          )
        )
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("BuildCommandFailedError")
        expect(stderr.join("")).toContain("renderer command exited with 1")
        expect(stderr.join("")).toContain("renderer dependency missing: @types/node")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test(
  "desktop check --repro preserves nested build stderr",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-repro-stderr-"))
        )
        try {
          yield* writePlaygroundFixture(directory)
          const appRoot = join(directory, "apps", "inspector")
          yield* Effect.promise(() =>
            writeFile(
              join(appRoot, "package.json"),
              '{"type":"module","scripts":{"build":"bun fail-renderer.ts"}}\n'
            )
          )
          yield* Effect.promise(() =>
            writeFile(
              join(appRoot, "fail-renderer.ts"),
              "console.error('renderer dependency missing: @types/node'); process.exit(1)\n"
            )
          )
          const stderr: string[] = []

          const exitCode = yield* runCli({
            argv: ["check", "--repro", "--config", "apps/inspector/desktop.config.ts", "--json"],
            cwd: directory,
            hostTarget: "linux-x64",
            writeStdout: () => {},
            writeStderr: (text) => {
              stderr.push(text)
            }
          })

          const payload = decodeCliJsonMessage(stderr.join(""))
          expect(exitCode).toBe(1)
          expect(payload.message).toContain("first build failed")
          expect(payload.message).toContain("renderer command exited with 1")
          expect(payload.message).toContain("renderer dependency missing: @types/node")
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      })
    ),
  CLI_REPRO_TEST_TIMEOUT_MS
)

test("desktop build rejects missing runtime.entry", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-missing-runtime-entry-"))
      )
      try {
        yield* writePlaygroundFixture(directory, { runtime: {} })
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("runtime.entry is required")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build rejects runtime.entry directories with a precise config error", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-runtime-entry-dir-"))
      )
      try {
        yield* writePlaygroundFixture(directory, { runtime: { entry: "src" } })
        const calls: string[] = []
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner: (invocation) =>
            Effect.sync(() => {
              calls.push(invocation.step)
            }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(calls).toEqual([])
        expect(stderr.join("")).toContain("BuildConfigError")
        expect(stderr.join("")).toContain("runtime.entry must be an existing file, not a directory")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build rejects unsupported runtime.engine before running build steps", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-runtime-engine-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          runtime: { engine: "deno", entry: "runtime.ts" }
        })
        const calls: string[] = []
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner: (invocation) =>
            Effect.sync(() => {
              calls.push(invocation.step)
            }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(calls).toEqual([])
        expect(stderr.join("")).toContain("BuildConfigError")
        expect(stderr.join("")).toContain("runtime.engine must be one of bun, node")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build rejects runtime.entry outside the app root before running build steps", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-runtime-entry-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          runtime: { entry: "../../../outside-runtime.ts" }
        })
        yield* Effect.promise(() =>
          writeFile(join(directory, "outside-runtime.ts"), "console.log('outside')\n")
        )
        const calls: string[] = []
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner: (invocation) =>
            Effect.sync(() => {
              calls.push(invocation.step)
            }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(calls).toEqual([])
        expect(stderr.join("")).toContain("BuildConfigError")
        expect(stderr.join("")).toContain("runtime.entry")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build refuses non-matching platform targets with doctor remediation", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: [
            "build",
            "--config",
            "apps/inspector/desktop.config.ts",
            "--platform",
            "windows-x64"
          ],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner: () => Effect.void,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("BuildUnsupportedTargetError")
        expect(stderr.join("")).toContain("bun desktop doctor")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build rejects non-SemVer app.version", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-invalid-version-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          app: {
            id: "dev.effect-desktop.inspector",
            name: "ORIKA Playground",
            version: "not-semver"
          }
        })
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner: () => Effect.void,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("BuildConfigError")
        expect(stderr.join("")).toContain("app.version must be a SemVer X.Y.Z string")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build rejects invalid reverse-DNS app.id", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-invalid-appid-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          app: {
            id: "not a bundle id",
            name: "ORIKA Playground",
            version: "1.2.3"
          }
        })
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner: () => Effect.void,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("BuildConfigError")
        expect(stderr.join("")).toContain("app.id must be a reverse-DNS ASCII identifier")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build rejects renderer.dist outside the app root before running build steps", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-renderer-dist-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          renderer: {
            entry: "src/renderer/main.tsx",
            dist: "../../outside-dist"
          }
        })
        yield* Effect.promise(() => mkdir(join(directory, "outside-dist"), { recursive: true }))
        yield* Effect.promise(() =>
          writeFile(join(directory, "outside-dist", "index.html"), "<h1>outside</h1>")
        )
        let calls = 0
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner: () =>
            Effect.sync(() => {
              calls += 1
            }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const stagedRenderer = join(
          directory,
          "apps",
          "inspector",
          "build",
          "effect-desktop",
          "linux-x64",
          "renderer",
          "index.html"
        )
        expect(exitCode).toBe(1)
        expect(calls).toBe(0)
        expect(stderr.join("")).toContain("BuildConfigError")
        expect(stderr.join("")).toContain("renderer.dist")
        yield* expectEffectPromiseRejects(stat(stagedRenderer))
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build refuses renderer dist symlinks that escape dist", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-renderer-link-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        const appRoot = join(directory, "apps", "inspector")
        yield* Effect.promise(() => writeFile(join(appRoot, "secret.txt"), "external"))
        const runner: CommandRunner = (invocation) =>
          Effect.gen(function* () {
            if (invocation.step === "renderer") {
              yield* runBuildFixtureIo(invocation, () =>
                mkdir(join(invocation.cwd, "dist"), { recursive: true })
              )
              yield* runBuildFixtureIo(invocation, () =>
                symlink("../secret.txt", join(invocation.cwd, "dist", "secret.txt"))
              )
            }
          })
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner: runner,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const stagedSecret = join(
          appRoot,
          "build",
          "effect-desktop",
          "linux-x64",
          "renderer",
          "secret.txt"
        )
        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("BuildFileError")
        expect(stderr.join("")).toContain("points outside")
        yield* expectEffectPromiseRejects(stat(stagedSecret))
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build rejects invalid security config before running build steps", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-security-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          security: { externalNavigation: "teleport", devtoolsInProd: "sometimes" }
        })
        const stderr: string[] = []
        const calls: string[] = []
        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner: (invocation) =>
            Effect.sync(() => {
              calls.push(invocation.step)
            }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("BuildConfigError")
        expect(stderr.join("")).toContain("security.externalNavigation")
        expect(calls).toEqual([])
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build emits validated renderer security policy", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-security-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          security: {
            externalNavigation: "ask",
            devtoolsInProd: true,
            csp: {
              policy: "connect-src 'self'; frame-src 'none'; upgrade-insecure-requests"
            }
          }
        })
        const runner: CommandRunner = (invocation) =>
          writeBuildFixtureOutput(invocation, { runtimeJs: "runtime" })
        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner: runner,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        const manifest = decodeRendererSecurityManifestJson(
          yield* Effect.promise(() =>
            readFile(
              join(
                directory,
                "apps",
                "inspector",
                "build",
                "effect-desktop",
                "linux-x64",
                "app-manifest.json"
              ),
              "utf8"
            )
          )
        )

        expect(exitCode).toBe(0)
        expect(manifest.rendererManifest.navigationPolicy).toBe("ask")
        expect(manifest.rendererManifest.devtoolsInProd).toBe(true)
        expect(
          manifest.rendererManifest.csp.directives.find(
            (directive) => directive.name === "connect-src"
          )
        ).toEqual({ name: "connect-src", values: ["'self'"] })
        expect(
          manifest.rendererManifest.csp.directives.find(
            (directive) => directive.name === "frame-src"
          )
        ).toEqual({ name: "frame-src", values: ["'none'"] })
        expect(
          manifest.rendererManifest.csp.directives.find(
            (directive) => directive.name === "upgrade-insecure-requests"
          )
        ).toEqual({ name: "upgrade-insecure-requests", values: [] })
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build emits disabled renderer CSP policy when explicitly acknowledged", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-disabled-csp-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          security: {
            csp: {
              disabled: true,
              acknowledgeWeakening: true,
              justification: "test fixture verifies disabled CSP serialization"
            }
          }
        })
        const runner: CommandRunner = (invocation) =>
          writeBuildFixtureOutput(invocation, { runtimeJs: "runtime" })
        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner: runner,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        const manifest = decodeRendererDisabledCspManifestJson(
          yield* Effect.promise(() =>
            readFile(
              join(
                directory,
                "apps",
                "inspector",
                "build",
                "effect-desktop",
                "linux-x64",
                "app-manifest.json"
              ),
              "utf8"
            )
          )
        )

        expect(exitCode).toBe(0)
        expect(manifest.rendererManifest.csp.directives).toEqual([])
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build rejects invalid window config before running build steps", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-windows-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          windows: {
            defaults: {
              titleBarStyle: "floating-space-station",
              trafficLights: { x: -10, y: -20 },
              hasShadow: "yes",
              backgroundColor: "not-a-color"
            },
            main: {
              route: "/",
              width: 0,
              height: -1
            }
          }
        })
        const stderr: string[] = []
        const calls: string[] = []
        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner: (invocation) =>
            Effect.sync(() => {
              calls.push(invocation.step)
            }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("BuildConfigError")
        expect(stderr.join("")).toContain("windows.defaults.titleBarStyle")
        expect(calls).toEqual([])
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop build rejects startup window names the runtime cannot launch", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const windowName of ["", "__proto__", "constructor", "prototype"]) {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-build-window-names-"))
        )
        try {
          yield* writePlaygroundFixture(directory, {
            windows: Object.fromEntries([
              [
                windowName,
                {
                  title: "Bad Window",
                  route: "/"
                }
              ]
            ])
          })
          if (windowName === "__proto__") {
            const configJson = stringifyJson(
              {
                app: {
                  id: "dev.effect-desktop.inspector",
                  name: "ORIKA Playground",
                  version: "0.0.0"
                },
                runtime: { entry: "runtime.ts" },
                renderer: {
                  entry: "src/renderer/main.tsx",
                  dist: "dist"
                },
                windows: Object.fromEntries([
                  [
                    windowName,
                    {
                      title: "Bad Window",
                      route: "/"
                    }
                  ]
                ])
              },
              2
            )
            yield* Effect.promise(() =>
              writeFile(
                join(directory, "apps", "inspector", "desktop.config.ts"),
                `export default JSON.parse(${JSON.stringify(configJson)}) as const\n`
              )
            )
          }
          const stderr: string[] = []
          const calls: string[] = []
          const exitCode = yield* runCli({
            argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
            cwd: directory,
            hostTarget: "linux-x64",
            commandRunner: (invocation) =>
              Effect.sync(() => {
                calls.push(invocation.step)
              }),
            writeStdout: () => {},
            writeStderr: (text) => {
              stderr.push(text)
            }
          })

          expect(exitCode).toBe(1)
          expect(stderr.join("")).toContain("BuildConfigError")
          expect(stderr.join("")).toContain(`windows.${windowName}`)
          expect(stderr.join("")).toContain("non-empty non-reserved window name")
          expect(calls).toEqual([])
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      }
    })
  ))

test("desktop build emits validated window config in host manifest", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-build-windows-"))
      )
      try {
        const windows = {
          defaults: {
            titleBarStyle: "hiddenInset",
            trafficLights: { x: 12, y: 12 },
            hasShadow: true,
            backgroundColor: "#ffffff"
          },
          main: {
            title: "Inspector",
            route: "/",
            width: 1200,
            height: 800
          }
        }
        yield* writePlaygroundFixture(directory, { windows })
        const runner: CommandRunner = (invocation) =>
          writeBuildFixtureOutput(invocation, { runtimeJs: "runtime" })

        const exitCode = yield* runCli({
          argv: ["build", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          commandRunner: runner,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        const manifest = decodeHostWindowsManifestJson(
          yield* Effect.promise(() =>
            readFile(
              join(
                directory,
                "apps",
                "inspector",
                "build",
                "effect-desktop",
                "linux-x64",
                "app-manifest.json"
              ),
              "utf8"
            )
          )
        )

        expect(exitCode).toBe(0)
        expect(manifest.hostManifest.windows).toEqual(windows)
        const startupWindows = manifest.runtimeManifest.env["EFFECT_DESKTOP_STARTUP_WINDOWS"]
        expect(startupWindows).toBeDefined()
        expect(JSON.parse(startupWindows ?? "")).toEqual({
          main: {
            title: "Inspector",
            width: 1200,
            height: 800,
            renderer: "/"
          }
        })
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package --help exits zero with usage", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stdout: string[] = []
      const exitCode = yield* runCli({
        argv: ["package", "--help"],
        cwd: process.cwd(),
        packageCommandRunner: () => Effect.die("package runner should not run for help"),
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })

      expect(exitCode).toBe(0)
      expect(stdout.join("")).toContain("desktop package")
    })
  ))

test("desktop package reports missing build output before reading manifests", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-missing-build-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["package", "--config", "apps/inspector/desktop.config.ts", "--json"],
          cwd: directory,
          hostTarget: "macos-arm64",
          packageCommandRunner: () => Effect.void,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const error = decodePackageMissingBuildArtifactJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(error.tag).toBe("PackageMissingBuildArtifactError")
        expect(error.message).toContain("app-manifest.json")
        expect(error.message).toContain("run desktop build first")
        expect(error.remediation).toContain("bun desktop build")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package rejects malformed build manifests as typed package errors", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-manifest-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writeBuildLayoutFixture(directory, "macos-arm64")
        const layout = join(
          directory,
          "apps",
          "inspector",
          "build",
          "effect-desktop",
          "macos-arm64"
        )
        yield* Effect.promise(() =>
          writeFile(
            join(layout, "app-manifest.json"),
            stringifyJson(
              {
                id: "dev.effect-desktop.inspector",
                name: "ORIKA Playground",
                version: "0.0.0",
                target: "macos-arm64"
              },
              2
            )
          )
        )
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: [
            "package",
            "--config",
            "apps/inspector/desktop.config.ts",
            "--artifact",
            "app",
            "--json"
          ],
          cwd: directory,
          hostTarget: "macos-arm64",
          packageCommandRunner: () =>
            Effect.die("package commands should not run for bad manifest"),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("PackageFileError")
        expect(payload.message).toContain("app-manifest.json")
        expect(payload.message).toContain("renderer")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package rejects malformed runtime launch manifests", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-runtime-manifest-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writeBuildLayoutFixture(directory, "macos-arm64")
        const layout = join(
          directory,
          "apps",
          "inspector",
          "build",
          "effect-desktop",
          "macos-arm64"
        )
        const hostBinary = hostBinaryName("macos-arm64")
        yield* Effect.promise(() =>
          writeFile(
            join(layout, "app-manifest.json"),
            stringifyJson(
              {
                id: "dev.effect-desktop.inspector",
                name: "ORIKA Playground",
                version: "0.0.0",
                target: "macos-arm64",
                renderer: { path: "renderer" },
                runtimeManifest: {
                  engine: "deno",
                  entry: "runtime/main.js",
                  executable: "deno",
                  args: ["runtime/main.js"],
                  env: {}
                },
                nativeHost: { binary: `native/${hostBinary}` }
              },
              2
            )
          )
        )
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: [
            "package",
            "--config",
            "apps/inspector/desktop.config.ts",
            "--artifact",
            "app",
            "--json"
          ],
          cwd: directory,
          hostTarget: "macos-arm64",
          packageCommandRunner: () =>
            Effect.die("package commands should not run for bad manifest"),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const payload = decodeCliJsonError(stderr.join(""))
        expect(exitCode).toBe(1)
        expect(payload.tag).toBe("PackageFileError")
        expect(payload.message).toContain("runtimeManifest.engine")
        expect(payload.message).toContain("bun, node")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package rejects runtime launch contract drift and path escapes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases = [
        {
          name: "missing-executable",
          mutate: (manifest: Record<string, unknown>) => {
            delete (manifest["runtimeManifest"] as Record<string, unknown>)["executable"]
          },
          message: "runtimeManifest.executable"
        },
        {
          name: "executable-mismatch",
          mutate: (manifest: Record<string, unknown>) => {
            ;(manifest["runtimeManifest"] as Record<string, unknown>)["executable"] = "bun"
          },
          message: "runtimeManifest.executable must match runtimeManifest.engine"
        },
        {
          name: "args-mismatch",
          mutate: (manifest: Record<string, unknown>) => {
            ;(manifest["runtimeManifest"] as Record<string, unknown>)["args"] = ["runtime/other.js"]
          },
          message: "runtimeManifest.args must exactly equal [runtimeManifest.entry]"
        },
        {
          name: "env-key",
          mutate: (manifest: Record<string, unknown>) => {
            ;(manifest["runtimeManifest"] as Record<string, unknown>)["env"] = {
              "BAD=KEY": "value"
            }
          },
          message: "runtimeManifest.env.BAD=KEY"
        },
        {
          name: "runtime-traversal",
          mutate: (manifest: Record<string, unknown>) => {
            const runtime = manifest["runtimeManifest"] as Record<string, unknown>
            runtime["entry"] = "../outside.js"
            runtime["args"] = ["../outside.js"]
          },
          message: "runtimeManifest.entry must be a relative path inside the build layout"
        },
        {
          name: "renderer-traversal",
          mutate: (manifest: Record<string, unknown>) => {
            manifest["renderer"] = { path: "../renderer" }
          },
          message: "renderer.path must be a relative path inside the build layout"
        },
        {
          name: "native-traversal",
          mutate: (manifest: Record<string, unknown>) => {
            manifest["nativeHost"] = { binary: "../host" }
          },
          message: "nativeHost.binary must be a relative path inside the build layout"
        }
      ] as const

      for (const testCase of cases) {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), `effect-desktop-cli-package-${testCase.name}-`))
        )
        try {
          yield* writePlaygroundFixture(directory, {
            runtime: { engine: "node", entry: "runtime.ts" }
          })
          yield* writeBuildLayoutFixture(directory, "linux-x64", "node")
          const layout = join(
            directory,
            "apps",
            "inspector",
            "build",
            "effect-desktop",
            "linux-x64"
          )
          const manifestPath = join(layout, "app-manifest.json")
          const manifest = {
            ...decodeJsonObject(yield* Effect.promise(() => readFile(manifestPath, "utf8")))
          }
          testCase.mutate(manifest)
          yield* Effect.promise(() => writeFile(manifestPath, stringifyJson(manifest, 2)))
          const stderr: string[] = []

          const exitCode = yield* runCli({
            argv: [
              "package",
              "--config",
              "apps/inspector/desktop.config.ts",
              "--artifact",
              "appimage",
              "--json"
            ],
            cwd: directory,
            hostTarget: "linux-x64",
            packageCommandRunner: () =>
              Effect.die("package commands should not run for bad manifest"),
            writeStdout: () => {},
            writeStderr: (text) => {
              stderr.push(text)
            }
          })

          const payload = decodeCliJsonError(stderr.join(""))
          expect(exitCode).toBe(1)
          expect(payload.tag).toBe("PackageFileError")
          expect(payload.message).toContain(testCase.message)
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      }
    })
  ))

test("desktop package accepts node runtime launch manifests", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-node-runtime-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          runtime: { engine: "node", entry: "runtime.ts" }
        })
        yield* writeBuildLayoutFixture(directory, "linux-x64", "node")
        const calls: string[] = []
        const runner: PackageCommandRunner = (invocation) =>
          Effect.gen(function* () {
            calls.push(invocation.step)
            const output = invocation.args.at(-1)
            if (output !== undefined) {
              yield* runPackageFixtureIo(invocation, () => writeFile(output, invocation.step))
            }
          })

        const exitCode = yield* runCli({
          argv: [
            "package",
            "--config",
            "apps/inspector/desktop.config.ts",
            "--artifact",
            "appimage"
          ],
          cwd: directory,
          hostTarget: "linux-x64",
          packageCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
        expect(calls).toEqual(["linux-appimage"])
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package emits macOS app dmg zip artifacts with metadata", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writeBuildLayoutFixture(directory, "macos-arm64")
        const outputRoot = join(directory, "apps", "inspector", "dist", "desktop", "macos")
        const calls: string[] = []
        const runner: PackageCommandRunner = (invocation) =>
          Effect.gen(function* () {
            calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
            const output = invocation.args.at(-1)
            if (output !== undefined) {
              yield* runPackageFixtureIo(invocation, () => writeFile(output, invocation.step))
            }
          })

        const stdout: string[] = []
        const exitCode = yield* runCli({
          argv: ["package", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "macos-arm64",
          now: fixedClock([100, 120, 200, 230, 300, 340]),
          packageCommandRunner: runner,
          writeStdout: (text) => {
            stdout.push(text)
          },
          writeStderr: () => {}
        })

        const appRoot = join(outputRoot, "ORIKA-Playground-0.0.0-macos-arm64")
        const dmgRoot = join(outputRoot, "ORIKA-Playground-0.0.0-macos-arm64.dmg")
        const zipRoot = join(outputRoot, "ORIKA-Playground-0.0.0-macos-arm64.zip")
        const appMetadata = decodePackageAppMetadataJson(
          yield* Effect.promise(() => readFile(join(appRoot, "artifact.json"), "utf8"))
        )
        const packageReport = decodeJsonObject(
          yield* Effect.promise(() => readFile(join(outputRoot, "package-report.json"), "utf8"))
        )

        expect(exitCode).toBe(0)
        expect(stdout.join("")).toContain("ORIKA package")
        expect(calls).toEqual([
          `macos-dmg:hdiutil create -srcFolder ${join(appRoot, "ORIKA-Playground.app")} -o ${join(dmgRoot, "ORIKA-Playground-0.0.0-macos-arm64.dmg")}`,
          `macos-zip:ditto -c -k --keepParent ${join(appRoot, "ORIKA-Playground.app")} ${join(zipRoot, "ORIKA-Playground-0.0.0-macos-arm64.zip")}`
        ])
        expect(
          yield* Effect.promise(() =>
            readFile(join(appRoot, "ORIKA-Playground.app", "Contents", "Info.plist"), "utf8")
          )
        ).toContain("dev.effect-desktop.inspector")
        expect(appMetadata.kind).toBe("app")
        expect(appMetadata.sha256).toHaveLength(64)
        expect(appMetadata.providerBudgetChecks).toEqual([
          expect.objectContaining({
            metric: "artifact-bytes",
            budget: 65_536,
            status: "pass"
          })
        ])
        expect(packageReport).toMatchObject({
          providers: {
            runtime: "bun",
            runtimePackaging: "source",
            webEngine: "system"
          }
        })
        expect(
          yield* Effect.promise(() => readFile(join(dmgRoot, "checksums.txt"), "utf8"))
        ).toContain(".dmg")
        expect(
          yield* Effect.promise(() => readFile(join(zipRoot, "checksums.txt"), "utf8"))
        ).toContain(".zip")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package does not wrap macOS app artifact in a fake app bundle", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-app-root-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writeBuildLayoutFixture(directory, "macos-arm64")
        const outputRoot = join(directory, "apps", "inspector", "dist", "desktop", "macos")
        const artifactRoot = join(outputRoot, "ORIKA-Playground-0.0.0-macos-arm64")
        const appBundle = join(artifactRoot, "ORIKA-Playground.app")

        const exitCode = yield* runCli({
          argv: ["package", "--config", "apps/inspector/desktop.config.ts", "--artifact", "app"],
          cwd: directory,
          hostTarget: "macos-arm64",
          now: fixedClock([100, 120, 200]),
          writeStdout: () => {},
          writeStderr: () => {}
        })

        const artifactRootStat = yield* Effect.promise(() => lstat(artifactRoot))
        const packageReport = decodeJsonObject(
          yield* Effect.promise(() => readFile(join(outputRoot, "package-report.json"), "utf8"))
        )

        expect(exitCode).toBe(0)
        expect(artifactRootStat.isDirectory()).toBe(true)
        expect(basename(artifactRoot).endsWith(".app")).toBe(false)
        expect(
          yield* Effect.promise(() => readFile(join(appBundle, "Contents", "Info.plist"), "utf8"))
        ).toContain("dev.effect-desktop.inspector")
        expect(packageReport).toMatchObject({
          artifacts: [
            {
              kind: "app",
              artifactPath: appBundle
            }
          ]
        })
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package removes stale fake macOS app wrapper artifacts", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-stale-app-root-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writeBuildLayoutFixture(directory, "macos-arm64")
        const outputRoot = join(directory, "apps", "inspector", "dist", "desktop", "macos")
        const staleRoot = join(outputRoot, "ORIKA-Playground-0.0.0-macos-arm64.app")
        const artifactRoot = join(outputRoot, "ORIKA-Playground-0.0.0-macos-arm64")

        yield* Effect.promise(() => mkdir(staleRoot, { recursive: true }))
        yield* Effect.promise(() => writeFile(join(staleRoot, "artifact.json"), "{}\n"))

        const exitCode = yield* runCli({
          argv: ["package", "--config", "apps/inspector/desktop.config.ts", "--artifact", "app"],
          cwd: directory,
          hostTarget: "macos-arm64",
          now: fixedClock([100, 120, 200]),
          writeStdout: () => {},
          writeStderr: () => {}
        })

        const staleRootExit = yield* Effect.exit(Effect.promise(() => lstat(staleRoot)))

        expect(exitCode).toBe(0)
        expect(staleRootExit).toMatchObject({ _tag: "Failure" })
        expect(
          yield* Effect.promise(() =>
            readFile(join(artifactRoot, "ORIKA-Playground.app", "Contents", "Info.plist"), "utf8")
          )
        ).toContain("dev.effect-desktop.inspector")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

packageModeTest("desktop package metadata digest includes directory file modes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-mode-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writeBuildLayoutFixture(directory, "macos-arm64")
        const outputRoot = join(directory, "apps", "inspector", "dist", "desktop", "macos")
        const appRoot = join(outputRoot, "ORIKA-Playground-0.0.0-macos-arm64")
        const runtimeMain = join(
          directory,
          "apps",
          "inspector",
          "build",
          "effect-desktop",
          "macos-arm64",
          "runtime",
          "main.js"
        )
        const runPackage = (): Effect.Effect<string> =>
          Effect.gen(function* () {
            const exitCode = yield* runCli({
              argv: [
                "package",
                "--config",
                "apps/inspector/desktop.config.ts",
                "--artifact",
                "app"
              ],
              cwd: directory,
              hostTarget: "macos-arm64",
              now: fixedClock([100, 120, 200]),
              writeStdout: () => {},
              writeStderr: () => {}
            })
            expect(exitCode).toBe(0)
            const appMetadata = decodePackageAppMetadataJson(
              yield* Effect.promise(() => readFile(join(appRoot, "artifact.json"), "utf8"))
            )
            expect(appMetadata.kind).toBe("app")
            expect(appMetadata.sha256).toHaveLength(64)
            return appMetadata.sha256
          })

        yield* Effect.promise(() => chmod(runtimeMain, 0o644))
        const firstDigest = yield* runPackage()

        yield* Effect.promise(() => chmod(runtimeMain, 0o444))
        const secondDigest = yield* runPackage()

        expect(secondDigest).not.toBe(firstDigest)
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  )
)

test("desktop package stages macOS app bundle before explicit dmg artifact", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-dmg-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writeBuildLayoutFixture(directory, "macos-arm64")
        const outputRoot = join(directory, "apps", "inspector", "dist", "desktop", "macos")
        const appRoot = join(outputRoot, "ORIKA-Playground-0.0.0-macos-arm64")
        const appBundle = join(appRoot, "ORIKA-Playground.app")
        const dmgRoot = join(outputRoot, "ORIKA-Playground-0.0.0-macos-arm64.dmg")
        const dmgPath = join(dmgRoot, "ORIKA-Playground-0.0.0-macos-arm64.dmg")
        const calls: string[] = []
        const runner: PackageCommandRunner = (invocation) =>
          Effect.gen(function* () {
            calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
            yield* runPackageFixtureIo(invocation, () => writeFile(dmgPath, invocation.step))
          })

        const report = yield* runDesktopPackage({
          cwd: directory,
          configPath: "apps/inspector/desktop.config.ts",
          platform: undefined,
          artifact: "dmg",
          commandRunner: runner,
          now: fixedClock([100, 120, 200, 230]),
          hostTarget: "macos-arm64"
        })

        expect(report.steps.map((step) => step.name)).toEqual([
          "macos-app",
          "macos-dmg",
          "metadata"
        ])
        expect(calls).toEqual([`macos-dmg:hdiutil create -srcFolder ${appBundle} -o ${dmgPath}`])
        expect(
          yield* Effect.promise(() => readFile(join(appBundle, "Contents", "Info.plist"), "utf8"))
        ).toContain("dev.effect-desktop.inspector")
        expect(report.artifacts.map((artifact) => artifact.kind)).toEqual(["dmg"])
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package stages macOS app bundle before explicit zip artifact", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-zip-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writeBuildLayoutFixture(directory, "macos-arm64")
        const outputRoot = join(directory, "apps", "inspector", "dist", "desktop", "macos")
        const appRoot = join(outputRoot, "ORIKA-Playground-0.0.0-macos-arm64")
        const appBundle = join(appRoot, "ORIKA-Playground.app")
        const zipRoot = join(outputRoot, "ORIKA-Playground-0.0.0-macos-arm64.zip")
        const zipPath = join(zipRoot, "ORIKA-Playground-0.0.0-macos-arm64.zip")
        const calls: string[] = []
        const runner: PackageCommandRunner = (invocation) =>
          Effect.gen(function* () {
            calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
            yield* runPackageFixtureIo(invocation, () => writeFile(zipPath, invocation.step))
          })

        const report = yield* runDesktopPackage({
          cwd: directory,
          configPath: "apps/inspector/desktop.config.ts",
          platform: undefined,
          artifact: "zip",
          commandRunner: runner,
          now: fixedClock([100, 120, 200, 230]),
          hostTarget: "macos-arm64"
        })

        expect(report.steps.map((step) => step.name)).toEqual([
          "macos-app",
          "macos-zip",
          "metadata"
        ])
        expect(calls).toEqual([`macos-zip:ditto -c -k --keepParent ${appBundle} ${zipPath}`])
        expect(
          yield* Effect.promise(() => readFile(join(appBundle, "Contents", "Info.plist"), "utf8"))
        ).toContain("dev.effect-desktop.inspector")
        expect(report.artifacts.map((artifact) => artifact.kind)).toEqual(["zip"])
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package preserves sibling artifacts during targeted runs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-siblings-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writeBuildLayoutFixture(directory, "macos-arm64")
        const outputRoot = join(directory, "apps", "inspector", "dist", "desktop", "macos")
        const zipRoot = join(outputRoot, "ORIKA-Playground-0.0.0-macos-arm64.zip")
        const dmgRoot = join(outputRoot, "ORIKA-Playground-0.0.0-macos-arm64.dmg")
        const zipPath = join(zipRoot, "ORIKA-Playground-0.0.0-macos-arm64.zip")
        const dmgPath = join(dmgRoot, "ORIKA-Playground-0.0.0-macos-arm64.dmg")
        const runner: PackageCommandRunner = (invocation) =>
          Effect.gen(function* () {
            const output = invocation.args.at(-1)
            if (output !== undefined) {
              yield* runPackageFixtureIo(invocation, () => writeFile(output, invocation.step))
            }
          })

        yield* runDesktopPackage({
          cwd: directory,
          configPath: "apps/inspector/desktop.config.ts",
          platform: undefined,
          artifact: "zip",
          commandRunner: runner,
          now: fixedClock([100, 120, 200, 230]),
          hostTarget: "macos-arm64"
        })

        yield* runDesktopPackage({
          cwd: directory,
          configPath: "apps/inspector/desktop.config.ts",
          platform: undefined,
          artifact: "dmg",
          commandRunner: runner,
          now: fixedClock([100, 120, 200, 230]),
          hostTarget: "macos-arm64"
        })

        expect(yield* Effect.promise(() => readFile(zipPath, "utf8"))).toBe("macos-zip")
        expect(yield* Effect.promise(() => readFile(dmgPath, "utf8"))).toBe("macos-dmg")
        expect(
          yield* Effect.promise(() => readFile(join(zipRoot, "checksums.txt"), "utf8"))
        ).toContain(".zip")
        expect(
          yield* Effect.promise(() => readFile(join(dmgRoot, "checksums.txt"), "utf8"))
        ).toContain(".dmg")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package rejects app.name that resolves to reserved basenames", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const appName of [".", ".."] as const) {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-cli-package-"))
        )
        try {
          yield* writePlaygroundFixture(directory, {
            app: { id: "dev.effect-desktop.inspector", name: appName, version: "0.0.0" }
          })
          const stderr: string[] = []

          const exitCode = yield* runCli({
            argv: ["package", "--config", "apps/inspector/desktop.config.ts"],
            cwd: directory,
            hostTarget: "macos-arm64",
            writeStdout: () => {},
            writeStderr: (text) => {
              stderr.push(text)
            }
          })

          const output = stderr.join("")
          expect(exitCode).toBe(1)
          expect(output).toContain("PackageConfigError")
          expect(output).toContain("app.name must not sanitize to . or ..")
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      }
    })
  ))

test("desktop package rejects control characters in package metadata", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const [label, appName] of [
        ["newline", "ORIKA\nInjected=Value"],
        ["carriage-return", "ORIKA\rInjected=Value"],
        ["nul", `ORIKA${String.fromCharCode(0)}Injected=Value`],
        ["del", `ORIKA${String.fromCharCode(127)}Injected=Value`]
      ] as const) {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), `effect-desktop-cli-package-${label}-`))
        )
        try {
          yield* writePlaygroundFixture(directory, {
            app: { id: "dev.effect-desktop.inspector", name: appName, version: "0.0.0" }
          })
          const stderr: string[] = []

          const exitCode = yield* runCli({
            argv: [
              "package",
              "--config",
              "apps/inspector/desktop.config.ts",
              "--artifact",
              "appimage"
            ],
            cwd: directory,
            hostTarget: "linux-x64",
            packageCommandRunner: () =>
              Effect.die("package commands should not run for invalid package metadata"),
            writeStdout: () => {},
            writeStderr: (text) => {
              stderr.push(text)
            }
          })

          const output = stderr.join("")
          expect(exitCode).toBe(1)
          expect(output).toContain("PackageConfigError")
          expect(output).toContain("app.name must not contain control characters")
        } finally {
          yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
        }
      }
    })
  ))

test("desktop package rejects non-SemVer app.version", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-invalid-version-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          app: {
            id: "dev.effect-desktop.inspector",
            name: "ORIKA Playground",
            version: "not-semver"
          }
        })
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: ["package", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("PackageConfigError")
        expect(stderr.join("")).toContain("app.version must be a SemVer X.Y.Z string")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package rejects path-shaped app.id before staging Linux sidecars", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-invalid-appid-"))
      )
      try {
        yield* writePlaygroundFixture(directory, {
          app: {
            id: "../../../escaped",
            name: "ORIKA Playground",
            version: "0.0.0"
          }
        })
        yield* writeBuildLayoutFixture(directory, "linux-x64")
        const calls: string[] = []
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["package", "--config", "apps/inspector/desktop.config.ts", "--artifact", "deb"],
          cwd: directory,
          hostTarget: "linux-x64",
          packageCommandRunner: (invocation) =>
            Effect.sync(() => {
              calls.push(invocation.step)
            }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(calls).toEqual([])
        expect(stderr.join("")).toContain("PackageConfigError")
        expect(stderr.join("")).toContain("app.id must be a reverse-DNS ASCII identifier")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package rejects build manifest app name drift", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-name-drift-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writeBuildLayoutFixture(directory, "macos-arm64")
        const layout = join(
          directory,
          "apps",
          "inspector",
          "build",
          "effect-desktop",
          "macos-arm64"
        )
        const manifestPath = join(layout, "app-manifest.json")
        const manifest = {
          ...decodeJsonObject(yield* Effect.promise(() => readFile(manifestPath, "utf8")))
        }
        manifest["name"] = "Different App"
        yield* Effect.promise(() => writeFile(manifestPath, `${stringifyJson(manifest, 2)}\n`))
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["package", "--config", "apps/inspector/desktop.config.ts", "--artifact", "app"],
          cwd: directory,
          hostTarget: "macos-arm64",
          packageCommandRunner: () => Effect.die("package commands should not run for name drift"),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("PackageFileError")
        expect(stderr.join("")).toContain("app-manifest.json")
        expect(stderr.join("")).toContain("ORIKA Playground")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package emits Linux AppImage deb rpm artifacts with metadata", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writeBuildLayoutFixture(directory, "linux-x64")
        const outputRoot = join(directory, "apps", "inspector", "dist", "desktop", "linux")
        const artifactPaths = {
          appimage: join(
            outputRoot,
            "ORIKA-Playground-0.0.0-linux-x64.AppImage",
            "ORIKA-Playground-0.0.0-linux-x64.AppImage"
          ),
          deb: join(
            outputRoot,
            "ORIKA-Playground-0.0.0-linux-x64.deb",
            "ORIKA-Playground-0.0.0-linux-x64.deb"
          ),
          rpm: join(
            outputRoot,
            "ORIKA-Playground-0.0.0-linux-x64.rpm",
            "ORIKA-Playground-0.0.0-linux-x64.rpm"
          )
        } as const
        const calls: string[] = []
        const runner: PackageCommandRunner = (invocation) =>
          Effect.gen(function* () {
            calls.push(`${invocation.step}:${invocation.command}`)
            if (invocation.step === "linux-appimage") {
              yield* runPackageFixtureIo(invocation, () =>
                writeFile(artifactPaths.appimage, "appimage")
              )
            }
            if (invocation.step === "linux-deb") {
              yield* runPackageFixtureIo(invocation, () => writeFile(artifactPaths.deb, "deb"))
            }
            if (invocation.step === "linux-rpm") {
              yield* runPackageFixtureIo(invocation, () => writeFile(artifactPaths.rpm, "rpm"))
            }
          })

        const exitCode = yield* runCli({
          argv: ["package", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "linux-x64",
          packageCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        const appImageRoot = join(outputRoot, "ORIKA-Playground-0.0.0-linux-x64.AppImage")
        const debMetadata = decodeLinuxPackageArtifactJson(
          yield* Effect.promise(() =>
            readFile(
              join(outputRoot, "ORIKA-Playground-0.0.0-linux-x64.deb", "artifact.json"),
              "utf8"
            )
          )
        )

        expect(exitCode).toBe(0)
        expect(calls).toEqual([
          "linux-appimage:appimagetool",
          "linux-deb:dpkg-deb",
          "linux-rpm:rpmbuild"
        ])
        expect(debMetadata).toMatchObject({ kind: "deb", sizeBytes: 3 })
        expect(debMetadata.linuxIntegration).toEqual({
          desktopFile: "dev.effect-desktop.inspector.desktop",
          appStreamId: "dev.effect-desktop.inspector.metainfo.xml",
          flatpakAppId: "dev.effect-desktop.inspector",
          snapName: "dev.effect-desktop.inspector"
        })
        expect(
          yield* Effect.promise(() =>
            readFile(
              join(
                appImageRoot,
                "ORIKA-Playground.AppDir",
                "share",
                "applications",
                "dev.effect-desktop.inspector.desktop"
              ),
              "utf8"
            )
          )
        ).toContain("X-Flatpak=dev.effect-desktop.inspector")
        expect(
          yield* Effect.promise(() =>
            readFile(
              join(appImageRoot, "ORIKA-Playground.AppDir", "share", "snap", "snapcraft.yaml"),
              "utf8"
            )
          )
        ).toContain("name: dev.effect-desktop.inspector")
        expect(
          yield* Effect.promise(() =>
            readFile(
              join(outputRoot, "ORIKA-Playground-0.0.0-linux-x64.rpm", "checksums.txt"),
              "utf8"
            )
          )
        ).toContain(".rpm")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package rejects build layout symlinks that escape the layout", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-link-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writeBuildLayoutFixture(directory, "linux-x64")
        const appRoot = join(directory, "apps", "inspector")
        const layout = join(appRoot, "build", "effect-desktop", "linux-x64")
        yield* Effect.promise(() => writeFile(join(appRoot, "secret.txt"), "external"))
        yield* Effect.promise(() =>
          symlink("../../../../secret.txt", join(layout, "renderer", "secret.txt"))
        )
        const calls: string[] = []
        const stderr: string[] = []

        const exitCode = yield* runCli({
          argv: ["package", "--config", "apps/inspector/desktop.config.ts", "--artifact", "deb"],
          cwd: directory,
          hostTarget: "linux-x64",
          packageCommandRunner: (invocation) =>
            Effect.sync(() => {
              calls.push(invocation.step)
            }),
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        const stagedSecret = join(
          appRoot,
          "dist",
          "desktop",
          "linux",
          "ORIKA-Playground-0.0.0-linux-x64.deb",
          "root",
          "usr",
          "lib",
          "effect-desktop-inspector",
          "renderer",
          "secret.txt"
        )
        expect(exitCode).toBe(1)
        expect(calls).toEqual([])
        expect(stderr.join("")).toContain("PackageFileError")
        expect(stderr.join("")).toContain("points outside")
        yield* expectEffectPromiseRejects(stat(stagedSecret))
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package maps linux arm64 RPM metadata to aarch64", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writeBuildLayoutFixture(directory, "linux-arm64")
        const outputRoot = join(directory, "apps", "inspector", "dist", "desktop", "linux")
        const rpmPath = join(
          outputRoot,
          "ORIKA-Playground-0.0.0-linux-arm64.rpm",
          "ORIKA-Playground-0.0.0-linux-arm64.rpm"
        )
        let spec = ""
        let args: readonly string[] = []
        const runner: PackageCommandRunner = (invocation) =>
          Effect.gen(function* () {
            args = invocation.args
            const specPath = invocation.args[1]
            if (typeof specPath === "string") {
              spec = yield* readPackageFixtureText(invocation, specPath)
            }
            yield* runPackageFixtureIo(invocation, () => writeFile(rpmPath, "rpm"))
          })

        const exitCode = yield* runCli({
          argv: ["package", "--config", "apps/inspector/desktop.config.ts", "--artifact", "rpm"],
          cwd: directory,
          hostTarget: "linux-arm64",
          packageCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
        expect(spec).toContain("BuildArch: aarch64")
        expect(args).toContain("_rpmfilename ORIKA-Playground-0.0.0-linux-arm64.rpm")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package emits Windows per-user MSI with app-specific UpgradeCode", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writeBuildLayoutFixture(directory, "windows-x64")
        const outputRoot = join(directory, "apps", "inspector", "dist", "desktop", "windows")
        const msiPath = join(
          outputRoot,
          "ORIKA-Playground-0.0.0-windows-x64.msi",
          "ORIKA-Playground-0.0.0-windows-x64.msi"
        )
        let wxs = ""
        const runner: PackageCommandRunner = (invocation) =>
          Effect.gen(function* () {
            const wxsPath = invocation.args[1]
            if (typeof wxsPath === "string") {
              wxs = yield* readPackageFixtureText(invocation, wxsPath)
            }
            yield* runPackageFixtureIo(invocation, () => writeFile(msiPath, "msi"))
          })

        const exitCode = yield* runCli({
          argv: ["package", "--config", "apps/inspector/desktop.config.ts"],
          cwd: directory,
          hostTarget: "windows-x64",
          packageCommandRunner: runner,
          writeStdout: () => {},
          writeStderr: () => {}
        })

        expect(exitCode).toBe(0)
        expect(wxs).toContain('Scope="perUser"')
        expect(wxs).toContain('<ComponentGroupRef Id="StartMenuShortcuts" />')
        expect(wxs).toContain('<StandardDirectory Id="ProgramMenuFolder">')
        expect(wxs).toContain(
          '<Directory Id="ApplicationProgramsFolder" Name="ORIKA Playground" />'
        )
        expect(wxs).toContain(
          '<Shortcut Id="ApplicationStartMenuShortcut" Name="ORIKA Playground" Description="ORIKA Playground" Target="[INSTALLFOLDER]native\\host.exe" WorkingDirectory="INSTALLFOLDER" />'
        )
        expect(wxs).toContain(
          '<RemoveFolder Id="RemoveApplicationProgramsFolder" Directory="ApplicationProgramsFolder" On="uninstall" />'
        )
        expect(wxs).not.toContain("00000000-0000-0000-0000-000000000064")
        expect(wxs).toMatch(
          /UpgradeCode="[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/
        )
        expect(wxs).toMatch(
          /<Component Id="StartMenuShortcut" Guid="[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}">/
        )
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("desktop package rejects Windows system-mode MSI as deferred scope", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-cli-package-"))
      )
      try {
        yield* writePlaygroundFixture(directory)
        yield* writeBuildLayoutFixture(directory, "windows-x64")
        const stderr: string[] = []
        const exitCode = yield* runCli({
          argv: [
            "package",
            "--config",
            "apps/inspector/desktop.config.ts",
            "--artifact",
            "system-msi"
          ],
          cwd: directory,
          hostTarget: "windows-x64",
          packageCommandRunner: () => Effect.void,
          writeStdout: () => {},
          writeStderr: (text) => {
            stderr.push(text)
          }
        })

        expect(exitCode).toBe(1)
        expect(stderr.join("")).toContain("PackageUnsupportedArtifactError")
        expect(stderr.join("")).toContain("deferred to v1.1")
      } finally {
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

const writePlaygroundFixture = (
  directory: string,
  extraConfig: Record<string, unknown> = {}
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const appRoot = join(directory, "apps", "inspector")
    const config = {
      app: {
        id: "dev.effect-desktop.inspector",
        name: "ORIKA Playground",
        version: "0.0.0"
      },
      runtime: { entry: "runtime.ts" },
      renderer: {
        entry: "src/renderer/main.tsx",
        dist: "dist"
      },
      ...extraConfig
    }
    yield* Effect.promise(() => mkdir(appRoot, { recursive: true }))
    yield* Effect.promise(() => mkdir(join(appRoot, "src", "renderer"), { recursive: true }))
    yield* Effect.promise(() =>
      writeFile(
        join(appRoot, "desktop.config.ts"),
        `export default ${stringifyJson(config, 2)} as const\n`
      )
    )
    yield* Effect.promise(() => writeFile(join(appRoot, "package.json"), '{"type":"module"}\n'))
    yield* Effect.promise(() => writeFile(join(appRoot, "runtime.ts"), "console.log('runtime')\n"))
    yield* Effect.promise(() =>
      writeFile(join(appRoot, "src/renderer/main.tsx"), "console.log('renderer')\n")
    )
    yield* Effect.promise(() => mkdir(join(directory, "target", "debug"), { recursive: true }))
  })

const writeBuildLayoutFixture = (
  directory: string,
  target: Extract<DesktopTargetId, "linux-arm64" | "linux-x64" | "macos-arm64" | "windows-x64">,
  runtimeEngine: "bun" | "node" = "bun"
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const layout = join(directory, "apps", "inspector", "build", "effect-desktop", target)
    const hostBinary = hostBinaryName(target)
    yield* Effect.promise(() => mkdir(join(layout, "renderer"), { recursive: true }))
    yield* Effect.promise(() => mkdir(join(layout, "runtime"), { recursive: true }))
    yield* Effect.promise(() => mkdir(join(layout, "native"), { recursive: true }))
    yield* Effect.promise(() => writeFile(join(layout, "renderer", "index.html"), "<h1>ok</h1>"))
    yield* Effect.promise(() =>
      writeFile(join(layout, "runtime", "main.js"), "console.log('runtime')\n")
    )
    yield* Effect.promise(() => writeFile(join(layout, "native", hostBinary), "host"))
    yield* Effect.promise(() =>
      writeFile(
        join(layout, "app-manifest.json"),
        `${stringifyJson(
          {
            id: "dev.effect-desktop.inspector",
            name: "ORIKA Playground",
            version: "0.0.0",
            target,
            renderer: { path: "renderer" },
            runtimeManifest: {
              engine: runtimeEngine,
              entry: "runtime/main.js",
              executable: runtimeEngine,
              args: ["runtime/main.js"],
              env: {}
            },
            nativeHost: { binary: `native/${hostBinary}` }
          },
          2
        )}\n`
      )
    )
    yield* Effect.promise(() =>
      writeFile(
        join(layout, "build-report.json"),
        `${stringifyJson(
          {
            appId: "dev.effect-desktop.inspector",
            appName: "ORIKA Playground",
            appVersion: "0.0.0",
            target,
            providers: {
              runtime: runtimeEngine,
              runtimePackaging: "source",
              webEngine: "system"
            },
            providerBudgets: [
              {
                id: runtimeEngine,
                kind: "runtime",
                package: runtimeEngine === "bun" ? "@effect/platform-bun" : "@effect/platform-node",
                importPath: `@orika/core/providers/${runtimeEngine}`,
                startupBudgetMs: 25,
                bundleBudgetKb: 64
              }
            ],
            providerMeasurements: []
          },
          2
        )}\n`
      )
    )
  })

const fakeReleaseServices = (calls: string[], target: DesktopTargetId): ReleaseWorkflowApi => ({
  package: () =>
    Effect.sync(() => {
      calls.push("package")
      return {
        appId: "dev.effect-desktop.test",
        appName: "ORIKA Test",
        appVersion: "1.2.3",
        target,
        layoutPath: "/build",
        outputPath: "/release",
        providers: undefined,
        artifacts: [
          {
            kind: target.startsWith("macos-") ? "dmg" : "appimage",
            target,
            artifactPath: "/release/artifact",
            artifactJsonPath: "/release/artifact.json",
            checksumsPath: "/release/checksums.txt",
            appId: "dev.effect-desktop.test",
            appName: "ORIKA Test",
            appVersion: "1.2.3",
            sizeBytes: 12,
            sha256: "abc",
            providerBudgetChecks: []
          }
        ],
        steps: []
      }
    }),
  sign: () =>
    Effect.sync(() => {
      calls.push("sign")
      return {
        appId: "dev.effect-desktop.test",
        appName: "ORIKA Test",
        appVersion: "1.2.3",
        target,
        outputPath: "/release",
        artifacts: [
          {
            kind: target.startsWith("macos-") ? "dmg" : "appimage",
            artifactPath: "/release/artifact",
            signedPaths: ["/release/artifact"]
          }
        ],
        steps: []
      }
    }),
  notarize: () =>
    Effect.sync(() => {
      calls.push("notarize")
      return {
        appId: "dev.effect-desktop.test",
        appName: "ORIKA Test",
        appVersion: "1.2.3",
        target: "macos-arm64",
        outputPath: "/release",
        artifacts: [
          {
            kind: "dmg",
            artifactPath: "/release/artifact",
            alreadyStapled: false,
            assessed: true
          }
        ],
        steps: []
      }
    }),
  publish: () =>
    Effect.sync(() => {
      calls.push("publish")
      return {
        appId: "dev.effect-desktop.test",
        version: "1.2.3",
        channel: "stable",
        keyVersion: 1,
        manifestPath: "/release/update-manifest.json",
        canonicalBytes: "{}",
        artifacts: []
      }
    })
})

const writePackagedArtifactFixture = (
  directory: string,
  target: Extract<DesktopTargetId, "linux-x64" | "macos-arm64" | "windows-x64">,
  kind: Extract<DesktopArtifactKind, "app" | "appimage" | "dmg" | "msi" | "zip">
): Effect.Effect<string, never, never> =>
  Effect.gen(function* () {
    const platform = desktopPlatformDirectory(target)
    const extension = desktopArtifactExtension(kind)
    const root = join(
      directory,
      "apps",
      "inspector",
      "dist",
      "desktop",
      platform,
      kind === "app"
        ? `ORIKA-Playground-0.0.0-${target}`
        : `ORIKA-Playground-0.0.0-${target}.${extension}`
    )
    const fileName =
      kind === "app" ? "ORIKA-Playground.app" : `ORIKA-Playground-0.0.0-${target}.${extension}`
    const artifactPath = join(root, fileName)
    if (kind === "app") {
      yield* Effect.promise(() =>
        mkdir(join(artifactPath, "Contents", "MacOS"), { recursive: true })
      )
      yield* Effect.promise(() =>
        mkdir(join(artifactPath, "Contents", "Resources", "effect-desktop", "native"), {
          recursive: true
        })
      )
      yield* Effect.promise(() =>
        mkdir(join(artifactPath, "Contents", "Resources", "effect-desktop", "runtime"), {
          recursive: true
        })
      )
      yield* Effect.promise(() =>
        writeFile(join(artifactPath, "Contents", "MacOS", "ORIKA-Playground"), "host")
      )
      yield* Effect.promise(() =>
        writeFile(
          join(artifactPath, "Contents", "Resources", "effect-desktop", "native", "host"),
          "host"
        )
      )
      yield* Effect.promise(() =>
        writeFile(
          join(artifactPath, "Contents", "Resources", "effect-desktop", "runtime", "main.js"),
          "runtime"
        )
      )
    } else {
      yield* Effect.promise(() => mkdir(root, { recursive: true }))
      yield* Effect.promise(() => writeFile(artifactPath, kind))
    }
    const digest = yield* digestArtifactFixture(artifactPath)
    const linuxIntegration =
      platform === "linux"
        ? {
            linuxIntegration: {
              desktopFile: "dev.effect-desktop.inspector.desktop",
              appStreamId: "dev.effect-desktop.inspector.metainfo.xml",
              flatpakAppId: "dev.effect-desktop.inspector",
              snapName: "dev.effect-desktop.inspector"
            }
          }
        : {}
    yield* Effect.promise(() =>
      writeFile(
        join(root, "artifact.json"),
        `${stringifyJson(
          {
            appId: "dev.effect-desktop.inspector",
            appName: "ORIKA Playground",
            appVersion: "0.0.0",
            kind,
            target,
            fileName,
            ...digest,
            ...linuxIntegration
          },
          2
        )}\n`
      )
    )
    return artifactPath
  })

const digestArtifactFixture = (
  path: string
): Effect.Effect<{ readonly sizeBytes: number; readonly sha256: string }, never, never> =>
  Effect.gen(function* () {
    const pathStat = yield* Effect.promise(() => stat(path))
    if (!pathStat.isDirectory()) {
      const bytes = yield* Effect.promise(() => readFile(path))
      return {
        sizeBytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex")
      }
    }
    const files = yield* listFixtureFiles(path)
    const hash = createHash("sha256")
    let sizeBytes = 0
    for (const file of files.toSorted((left, right) =>
      left.relativePath.localeCompare(right.relativePath)
    )) {
      hash.update(file.kind)
      hash.update("\0")
      hash.update(file.relativePath)
      hash.update("\0")
      hash.update((file.mode & 0o777).toString(8))
      hash.update("\0")
      if (file.kind !== "file") {
        hash.update(file.target)
        hash.update("\0")
        continue
      }
      const content = yield* Effect.promise(() => readFile(file.absolutePath))
      sizeBytes += content.byteLength
      hash.update(content)
      hash.update("\0")
    }
    return { sizeBytes, sha256: hash.digest("hex") }
  })

type FixtureDirectoryEntryKind = "directory" | "file" | "symlink"

interface FixtureDirectoryEntry {
  readonly absolutePath: string
  readonly kind: FixtureDirectoryEntryKind
  readonly relativePath: string
  readonly mode: number
  readonly target: string
}

const listFixtureFiles = (
  path: string
): Effect.Effect<readonly FixtureDirectoryEntry[], never, never> => walkFixtureFiles(path, path)

const walkFixtureFiles = (
  rootPath: string,
  currentPath: string
): Effect.Effect<readonly FixtureDirectoryEntry[], never, never> =>
  Effect.gen(function* () {
    const entries = yield* Effect.promise(() => readdir(currentPath))
    const files: FixtureDirectoryEntry[] = []
    for (const entry of entries.toSorted()) {
      const child = join(currentPath, entry)
      const childStat = yield* Effect.promise(() => lstat(child))
      const childRelativePath = relative(rootPath, child)
      if (childStat.isDirectory()) {
        files.push({
          absolutePath: child,
          kind: "directory",
          relativePath: childRelativePath,
          mode: Number(childStat.mode),
          target: ""
        })
        files.push(...(yield* walkFixtureFiles(rootPath, child)))
      } else if (childStat.isSymbolicLink()) {
        const linkTarget = yield* Effect.promise(() => readlink(child))
        files.push({
          absolutePath: child,
          kind: "symlink",
          relativePath: childRelativePath,
          mode: Number(childStat.mode),
          target: linkTarget
        })
      } else {
        files.push({
          absolutePath: child,
          kind: "file",
          relativePath: childRelativePath,
          mode: Number(childStat.mode),
          target: ""
        })
      }
    }
    return files
  })

const writeApiFixturePackage = (root: string, source: string): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const packageRoot = join(root, "packages", "fixture")
    yield* Effect.promise(() => mkdir(join(packageRoot, "src"), { recursive: true }))
    yield* Effect.promise(() =>
      writeFile(
        join(packageRoot, "package.json"),
        stringifyJson(
          {
            name: "@orika/fixture",
            type: "module",
            exports: {
              ".": {
                types: "./src/index.ts",
                default: "./src/index.ts"
              }
            }
          },
          2
        )
      )
    )
    yield* Effect.promise(() =>
      writeFile(
        join(packageRoot, "tsconfig.json"),
        stringifyJson(
          {
            compilerOptions: {
              target: "ESNext",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              strict: true,
              noEmit: true,
              skipLibCheck: true,
              types: []
            },
            include: ["src"]
          },
          2
        )
      )
    )
    yield* Effect.promise(() => writeFile(join(packageRoot, "src", "index.ts"), source))
  })

const writeDocsFixture = (
  root: string,
  pages: Readonly<Record<string, string>>
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    yield* writeDocsManifest(
      root,
      Object.keys(pages).map((path) => ({
        id: "installation",
        title: "Installation",
        path
      }))
    )
    for (const [path, body] of Object.entries(pages)) {
      yield* Effect.promise(() => mkdir(dirname(join(root, path)), { recursive: true }))
      yield* Effect.promise(() => writeFile(join(root, path), body))
    }
  })

const writeDocsManifest = (
  root: string,
  pages: readonly unknown[],
  source = "test"
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    yield* Effect.promise(() => mkdir(join(root, "docs"), { recursive: true }))
    yield* Effect.promise(() =>
      writeFile(
        join(root, "docs", "docs-manifest.json"),
        stringifyJson(
          {
            schemaVersion: 1,
            source,
            pages
          },
          2
        )
      )
    )
  })

const writeReleaseFixture = (
  root: string,
  overrides: {
    readonly checklist?: unknown
    readonly ciWorkflow?: string
    readonly releaseWorkflow?: string
    readonly keyManagement?: string
    readonly releaseSettings?: string
  } = {}
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    yield* Effect.promise(() => mkdir(join(root, "release"), { recursive: true }))
    yield* Effect.promise(() => mkdir(join(root, ".github", "workflows"), { recursive: true }))
    yield* Effect.promise(() => mkdir(join(root, "engineering", "security"), { recursive: true }))
    yield* Effect.promise(() =>
      writeFile(
        join(root, "release", "checklist.json"),
        stringifyJson(overrides.checklist ?? releaseChecklistFixture(), 2)
      )
    )
    yield* Effect.promise(() =>
      writeFile(
        join(root, ".github", "workflows", "ci.yml"),
        overrides.ciWorkflow ?? ciWorkflowFixture()
      )
    )
    yield* Effect.promise(() =>
      writeFile(
        join(root, ".github", "workflows", "release.yml"),
        overrides.releaseWorkflow ?? releaseWorkflowFixture()
      )
    )
    yield* Effect.promise(() =>
      writeFile(
        join(root, "engineering", "security", "key-management.md"),
        overrides.keyManagement ?? keyManagementFixture()
      )
    )
    yield* Effect.promise(() =>
      writeFile(
        join(root, "engineering", "security", "release-settings.md"),
        overrides.releaseSettings ?? releaseSettingsFixture()
      )
    )
  })

const writeAccessibilityFixture = (
  root: string,
  overrides: {
    readonly manifest?: unknown
    readonly appSource?: string
    readonly styles?: string
    readonly messages?: string
    readonly manualAudit?: string
    readonly axePasses?: readonly unknown[]
    readonly axeUrlForMode?: (mode: string) => string
    readonly pa11yUrlForMode?: (mode: string) => string
  } = {}
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const auditRoot = join(root, "engineering", "audits", "v1.0.0", "fixture-a11y")
    const sourceRoot = join(root, "apps", "fixture-a11y", "src")
    yield* Effect.promise(() => mkdir(join(root, "release"), { recursive: true }))
    yield* Effect.promise(() => mkdir(auditRoot, { recursive: true }))
    yield* Effect.promise(() => mkdir(sourceRoot, { recursive: true }))
    yield* Effect.promise(() =>
      writeFile(
        join(root, "release", "accessibility.json"),
        stringifyJson(overrides.manifest ?? accessibilityManifestFixture(), 2)
      )
    )
    yield* Effect.promise(() =>
      writeFile(join(sourceRoot, "App.tsx"), overrides.appSource ?? accessibilityAppFixture())
    )
    yield* Effect.promise(() =>
      writeFile(join(sourceRoot, "styles.css"), overrides.styles ?? accessibilityStylesFixture())
    )
    yield* Effect.promise(() =>
      writeFile(
        join(sourceRoot, "messages.ts"),
        overrides.messages ?? accessibilityMessagesFixture()
      )
    )
    yield* Effect.promise(() =>
      writeFile(
        join(auditRoot, "manual-keyboard.md"),
        overrides.manualAudit ?? accessibilityManualAuditFixture()
      )
    )
    yield* Effect.promise(() =>
      writeFile(join(auditRoot, "keyboard-walkthrough.webm"), "fixture screencast\n")
    )
    for (const mode of ["light-ltr", "dark-ltr", "light-rtl", "dark-rtl"]) {
      yield* Effect.promise(() =>
        writeFile(
          join(auditRoot, `axe.${mode}.json`),
          stringifyJson(axeAuditFixture(mode, overrides.axePasses, overrides.axeUrlForMode), 2)
        )
      )
      yield* Effect.promise(() =>
        writeFile(
          join(auditRoot, `pa11y.${mode}.json`),
          stringifyJson(pa11yAuditFixture(mode, overrides.pa11yUrlForMode), 2)
        )
      )
    }
  })

const accessibilityManifestFixture = (): unknown => ({
  schemaVersion: 1,
  source: "engineering/SPEC.md §25.5",
  release: "v1.0.0",
  templates: [
    {
      id: "fixture-a11y",
      root: "apps/fixture-a11y",
      sourceFiles: [
        "apps/fixture-a11y/src/App.tsx",
        "apps/fixture-a11y/src/messages.ts",
        "apps/fixture-a11y/src/styles.css"
      ],
      i18nFiles: ["apps/fixture-a11y/src/messages.ts"],
      auditDir: "engineering/audits/v1.0.0/fixture-a11y",
      auditModes: [
        {
          id: "light-ltr",
          direction: "ltr",
          colorScheme: "light",
          axe: "engineering/audits/v1.0.0/fixture-a11y/axe.light-ltr.json",
          pa11y: "engineering/audits/v1.0.0/fixture-a11y/pa11y.light-ltr.json"
        },
        {
          id: "dark-ltr",
          direction: "ltr",
          colorScheme: "dark",
          axe: "engineering/audits/v1.0.0/fixture-a11y/axe.dark-ltr.json",
          pa11y: "engineering/audits/v1.0.0/fixture-a11y/pa11y.dark-ltr.json"
        },
        {
          id: "light-rtl",
          direction: "rtl",
          colorScheme: "light",
          axe: "engineering/audits/v1.0.0/fixture-a11y/axe.light-rtl.json",
          pa11y: "engineering/audits/v1.0.0/fixture-a11y/pa11y.light-rtl.json"
        },
        {
          id: "dark-rtl",
          direction: "rtl",
          colorScheme: "dark",
          axe: "engineering/audits/v1.0.0/fixture-a11y/axe.dark-rtl.json",
          pa11y: "engineering/audits/v1.0.0/fixture-a11y/pa11y.dark-rtl.json"
        }
      ],
      contrastPairs: [
        { id: "light-body", foreground: "#020617", background: "#f8fafc", minimumRatio: 4.5 }
      ],
      requiredTokens: [
        { file: "apps/fixture-a11y/src/styles.css", token: "prefers-reduced-motion" },
        { file: "apps/fixture-a11y/src/styles.css", token: "prefers-color-scheme" },
        { file: "apps/fixture-a11y/src/App.tsx", token: "resolveTemplateLocale" },
        { file: "apps/fixture-a11y/src/messages.ts", token: "ar" }
      ]
    }
  ]
})

const isAccessibilityManifestFixture = (
  value: unknown
): value is {
  readonly templates: readonly {
    readonly auditModes: readonly {
      readonly id: string
      readonly direction: string
      readonly colorScheme: string
      readonly axe: string
      readonly pa11y: string
    }[]
    readonly contrastPairs: readonly unknown[]
    readonly requiredTokens: readonly unknown[]
  }[]
} =>
  typeof value === "object" &&
  value !== null &&
  "templates" in value &&
  Array.isArray(value.templates)

const accessibilityAppFixture = (): string =>
  [
    "import { resolveTemplateLocale } from './messages'",
    "const { copy, direction, locale } = resolveTemplateLocale('en')",
    "export function App() {",
    "  return <main dir={direction} lang={locale}><button>{copy.openWindow}</button></main>",
    "}"
  ].join("\n")

const accessibilityStylesFixture = (): string =>
  [
    "@media (prefers-color-scheme: dark) { :root { color-scheme: dark; } }",
    "@media (prefers-reduced-motion: reduce) { * { transition-duration: 0.01ms; } }"
  ].join("\n")

const accessibilityMessagesFixture = (): string =>
  [
    "export const templateMessages = {",
    "  en: { openWindow: 'Open window' },",
    "  ar: { openWindow: 'افتح نافذة' }",
    "}"
  ].join("\n")

const accessibilityManualAuditFixture = (): string =>
  [
    "# fixture-a11y Manual Keyboard Audit",
    "Keyboard-only walkthrough: complete.",
    "Screencast: keyboard-walkthrough.webm",
    "RTL example: Arabic fixture complete.",
    "Sign-off: release operator"
  ].join("\n")

const axeAuditFixture = (
  mode: string,
  passes: readonly unknown[] = [{ id: "color-contrast" }],
  urlForMode: (mode: string) => string = defaultAxeUrlForMode
): unknown => ({
  url: urlForMode(mode),
  testEngine: { name: "axe-core", version: "4.x" },
  violations: [],
  incomplete: [],
  passes
})

const defaultAxeUrlForMode = (mode: string): string =>
  `fixture:${mode}?dir=${mode.endsWith("rtl") ? "rtl&lang=ar" : "ltr"}&color-scheme=${mode.startsWith("dark") ? "dark" : "light"}`

const pa11yAuditFixture = (
  mode: string,
  urlForMode: (mode: string) => string = defaultAxeUrlForMode
): unknown => ({
  url: urlForMode(mode),
  runner: "pa11y",
  standard: "WCAG2AA",
  issues: []
})

const writeSemverFixture = (
  root: string,
  overrides: {
    readonly manifest?: unknown
    readonly matrix?: unknown
    readonly packageVersion?: string
  } = {}
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    yield* Effect.promise(() => mkdir(join(root, "release"), { recursive: true }))
    yield* Effect.promise(() => mkdir(join(root, "engineering"), { recursive: true }))
    yield* Effect.promise(() => mkdir(join(root, "packages", "core"), { recursive: true }))
    yield* Effect.promise(() =>
      writeFile(
        join(root, "release", "semver.json"),
        stringifyJson(overrides.manifest ?? semverManifestFixture(), 2)
      )
    )
    yield* Effect.promise(() =>
      writeFile(
        join(root, "engineering", "verification-matrix.json"),
        stringifyJson(overrides.matrix ?? semverMatrixFixture(), 2)
      )
    )
    const packageVersion = overrides.packageVersion ?? "0.0.0"
    yield* Effect.promise(() =>
      writeFile(
        join(root, "packages", "core", "package.json"),
        stringifyJson({ name: "@orika/core", version: packageVersion }, 2)
      )
    )
  })

const semverManifestFixture = (): unknown => ({
  schemaVersion: 1,
  source: "engineering/SPEC.md §25.6",
  release: "1.1.0",
  releaseKind: "minor",
  publicApiSnapshots: "api/snapshots",
  verificationMatrix: "engineering/verification-matrix.json",
  appendixCRows: ["C.54", "C.71", "C.72", "C.81"],
  bridgeEnvelopePolicy: {
    source: "engineering/SPEC.md §9.3",
    frozenBetweenMajors: true,
    allowedChange: "fields may be added with defaults; fields may not be removed or reordered"
  },
  deprecationPolicy: {
    minimumMinorReleases: 3,
    requiresJSDocDeprecated: true
  }
})

const isJsonRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isSemverManifestFixture = (
  value: unknown
): value is {
  readonly appendixCRows: readonly string[]
  readonly deprecationPolicy: Readonly<Record<string, unknown>>
} =>
  isJsonRecord(value) &&
  "appendixCRows" in value &&
  Array.isArray(value["appendixCRows"]) &&
  isJsonRecord(value["deprecationPolicy"])

const semverMatrixFixture = (): Record<string, unknown> => ({
  schemaVersion: 1,
  source: "engineering/SPEC.md §20.10 and Appendix C",
  requiredCells: ["macos-arm64", "macos-x64", "windows-x64", "linux-x64"],
  optionalCells: ["windows-arm64", "linux-arm64"],
  ciCells: [
    {
      cell: "linux-x64",
      runner: "ubuntu-latest",
      headless: true
    },
    {
      cell: "macos-arm64",
      runner: "macos-latest",
      headless: true
    },
    {
      cell: "windows-x64",
      runner: "windows-latest",
      headless: true
    }
  ],
  manualGateCells: [
    {
      cell: "macos-x64",
      reason: "GitHub-hosted macOS runners are Apple Silicon only.",
      path: "engineering/manual-gates/macos.md"
    }
  ],
  defaults: {
    cells: ["macos-arm64", "macos-x64", "windows-x64", "linux-x64"],
    headless: true,
    requiresHardware: false
  },
  rows: {
    "C.54": {},
    "C.71": {},
    "C.72": {},
    "C.81": {}
  }
})

const publicApiReportFixture = (kind: "added" | "removed"): PublicApiSnapshotReport => ({
  passed: kind === "added",
  updated: false,
  packages: [],
  changes: [
    {
      packageName: "@orika/core",
      symbol: "Example",
      kind,
      ...(kind === "added"
        ? { after: { name: "Example", kind: "function", signature: "function Example(): void" } }
        : {
            before: {
              name: "Example",
              kind: "function",
              signature: "function Example(): void"
            }
          })
    }
  ]
})

const releaseChecklistFixture = (): unknown => ({
  schemaVersion: 1,
  source: "engineering/SPEC.md §25.4",
  subjects: [
    {
      id: "inspector",
      configPath: "apps/inspector/desktop.config.ts",
      distDir: "apps/inspector/dist",
      requiredCommands: [
        "bun packages/cli/src/bin.ts build --config apps/inspector/desktop.config.ts",
        "bun packages/cli/src/bin.ts package --config apps/inspector/desktop.config.ts",
        "bun packages/cli/src/bin.ts check --repro --config apps/inspector/desktop.config.ts",
        "bun packages/cli/src/bin.ts sign --config apps/inspector/desktop.config.ts"
      ]
    }
  ],
  gates: [
    {
      id: "spdx-sbom",
      title: "SPDX SBOM generation and signing",
      kind: "workflow-step",
      evidence: [".github/workflows/release.yml#Generate SPDX SBOM"]
    },
    {
      id: "cvss-scan",
      title: "CVSS >= 7.0 vulnerability scan",
      kind: "workflow-step",
      evidence: [
        ".github/workflows/release.yml#Scan release SBOM for high vulnerabilities",
        "engineering/security/release-settings.md#engineering/security/exemptions"
      ]
    },
    {
      id: "reproducible-build",
      title: "Reproducible build check",
      kind: "workflow-step",
      evidence: [".github/workflows/release.yml#Reproducible build gate"]
    },
    {
      id: "slsa-provenance",
      title: "SLSA v1.0 provenance attestation",
      kind: "workflow-step",
      evidence: [".github/workflows/release.yml#Attest release provenance"]
    },
    {
      id: "hsm-signing",
      title: "HSM-backed release signing",
      kind: "policy-document",
      evidence: [
        "engineering/security/key-management.md#HSM-backed",
        "engineering/security/key-management.md#runner-local keys are forbidden"
      ]
    },
    {
      id: "secret-scanning",
      title: "Secret scanning on every branch",
      kind: "repository-setting",
      evidence: [
        "engineering/security/release-settings.md#Secret scanning is enabled for every branch"
      ]
    },
    {
      id: "ephemeral-runners",
      title: "GitHub-hosted ephemeral runner posture",
      kind: "repository-setting",
      evidence: [
        "engineering/security/release-settings.md#GitHub-hosted runners",
        "engineering/security/release-settings.md#persistent self-hosted runners are forbidden"
      ]
    },
    {
      id: "branch-protection",
      title: "Branch protection review requirements",
      kind: "repository-setting",
      evidence: [
        "engineering/security/release-settings.md#main requires at least one review",
        "engineering/security/release-settings.md#release branches require at least two reviews"
      ]
    }
  ]
})

const isReleaseChecklistFixture = (
  value: unknown
): value is {
  readonly schemaVersion: 1
  readonly source: string
  readonly subjects: readonly {
    readonly id: string
    readonly configPath: string
    readonly distDir: string
    readonly requiredCommands: readonly string[]
  }[]
  readonly gates: readonly {
    readonly id: string
    readonly title: string
    readonly kind: string
    readonly evidence: readonly string[]
  }[]
} =>
  typeof value === "object" &&
  value !== null &&
  "subjects" in value &&
  Array.isArray(value.subjects) &&
  "gates" in value &&
  Array.isArray(value.gates)

const ciWorkflowFixture = (): string =>
  [
    "on:",
    "  push:",
    '    branches: ["**"]',
    "jobs:",
    "  validate:",
    "    strategy:",
    "      matrix:",
    "        include:",
    "          - os: ubuntu-latest",
    "          - os: macos-latest",
    "          - os: windows-latest",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: bun desktop check --repro regression tests",
    "        run: bun test packages/cli/src/index.test.ts -t repro",
    "      - name: bun desktop check --release",
    "        run: bun packages/cli/src/bin.ts check --release"
  ].join("\n")

const releaseWorkflowFixture = (): string =>
  [
    "name: release",
    "permissions:",
    "  artifact-metadata: write",
    "  attestations: write",
    "  id-token: write",
    "jobs:",
    "  release-gates:",
    "    runs-on: ubuntu-latest",
    "    env:",
    "      RELEASE_SIGNING_BACKEND: hsm",
    "    steps:",
    "      - name: Checkout",
    "        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2",
    "      - name: Build desktop app",
    "        run: bun packages/cli/src/bin.ts build --config apps/inspector/desktop.config.ts",
    "      - name: Package release artifact",
    "        run: bun packages/cli/src/bin.ts package --config apps/inspector/desktop.config.ts",
    "      - name: Reproducible build gate",
    "        run: bun packages/cli/src/bin.ts check --repro --config apps/inspector/desktop.config.ts",
    "      - name: Sign release artifacts with HSM backend",
    "        run: |",
    '          test "$RELEASE_SIGNING_BACKEND" = "hsm"',
    "          bun packages/cli/src/bin.ts sign --config apps/inspector/desktop.config.ts",
    "      - name: Generate SPDX SBOM",
    "        uses: anchore/sbom-action@e22c389904149dbc22b58101806040fa8d37a610 # v0.24.0",
    "        with:",
    "          format: spdx-json",
    "      - name: CVSS exemption policy",
    "        run: test -d engineering/security/exemptions",
    "      - name: Scan release SBOM for high vulnerabilities",
    "        uses: anchore/scan-action@e1165082ffb1fe366ebaf02d8526e7c4989ea9d2 # v7.4.0",
    "        with:",
    "          severity-cutoff: high",
    "          sbom: dist/desktop/effect-desktop.spdx.json",
    "      - name: Upload SBOM artifacts",
    "        run: echo sbom-artifacts",
    "      - name: Attest release provenance",
    "        uses: actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26 # v4.1.0",
    "        with:",
    "          subject-path: dist/desktop/**",
    "      - name: Attest signed SBOM",
    "        uses: actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26 # v4.1.0",
    "        with:",
    "          subject-path: dist/desktop/effect-desktop.spdx.json",
    "          sbom-path: dist/desktop/effect-desktop.spdx.json"
  ].join("\n")

const keyManagementFixture = (): string =>
  [
    "# Release Key Management",
    "",
    "Release artifacts use an HSM-backed key.",
    "runner-local keys are forbidden for release jobs.",
    "Key rotation is recorded for every trust-anchor change."
  ].join("\n")

const releaseSettingsFixture = (): string =>
  [
    "# Release Repository Settings",
    "",
    "Secret scanning is enabled for every branch.",
    "main requires at least one review.",
    "release branches require at least two reviews.",
    "GitHub-hosted runners allocate a fresh virtual machine for each job.",
    "persistent self-hosted runners are forbidden for release jobs.",
    "CVSS exemptions live under engineering/security/exemptions."
  ].join("\n")

const testEd25519Key = (): { readonly privateKeyPem: string; readonly publicKey: string } => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  const publicDer = publicKey.export({ type: "spki", format: "der" })
  return {
    privateKeyPem,
    publicKey: `ed25519:${publicDer.subarray(publicDer.length - 32).toString("base64")}`
  }
}

const verifyUpdateManifest = (manifest: UpdateManifest, publicKey: string): boolean => {
  const publicKeyBytes = Buffer.from(publicKey.slice("ed25519:".length), "base64")
  const publicKeyObject = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKeyBytes]),
    format: "der",
    type: "spki"
  })
  return cryptoVerify(
    null,
    Buffer.from(canonicalUpdateManifestBytes(manifest)),
    publicKeyObject,
    Buffer.from(manifest.signature.slice("ed25519:".length), "base64")
  )
}

const deterministicBuildRunner = (): CommandRunner => (invocation) =>
  writeBuildFixtureOutput(invocation, { runtimeJs: "console.log('runtime')\n" })

const deterministicPackageRunner =
  (content: () => string): PackageCommandRunner =>
  (invocation) =>
    Effect.gen(function* () {
      if (invocation.step === "linux-deb") {
        const output = invocation.args.at(-1)
        if (output !== undefined) {
          yield* runPackageFixtureIo(invocation, () => writeFile(output, content()))
        }
      }
    })

const modeDriftPackageRunner =
  (mode: () => number): PackageCommandRunner =>
  (invocation) =>
    Effect.gen(function* () {
      if (invocation.step === "linux-deb") {
        const output = invocation.args.at(-1)
        if (output !== undefined) {
          yield* runPackageFixtureIo(invocation, () => writeFile(output, "deb"))
          const dir = dirname(output)
          const hostPath = join(dir, "host")
          yield* runPackageFixtureIo(invocation, () => writeFile(hostPath, "host"))
          yield* runPackageFixtureIo(invocation, () => chmod(hostPath, mode()))
        }
      }
    })

const symlinkDriftPackageRunner =
  (mode: () => "symlink" | "symlink-a" | "symlink-b" | "regular"): PackageCommandRunner =>
  (invocation) =>
    Effect.gen(function* () {
      if (invocation.step === "linux-deb") {
        const output = invocation.args.at(-1)
        if (output !== undefined) {
          yield* runPackageFixtureIo(invocation, () => writeFile(output, "deb"))
          const dir = dirname(output)
          const linkPath = join(dir, "app-link")
          yield* runPackageFixtureIo(invocation, () => writeFile(join(dir, "target-a.txt"), "a"))
          yield* runPackageFixtureIo(invocation, () => writeFile(join(dir, "target-b.txt"), "b"))
          const decision = mode()
          if (decision === "symlink") {
            yield* runPackageFixtureIo(invocation, () => symlink("target-a.txt", linkPath))
          } else if (decision === "symlink-a") {
            yield* runPackageFixtureIo(invocation, () => symlink("target-a.txt", linkPath))
          } else if (decision === "symlink-b") {
            yield* runPackageFixtureIo(invocation, () => symlink("target-b.txt", linkPath))
          } else {
            yield* runPackageFixtureIo(invocation, () => writeFile(linkPath, "regular"))
          }
        }
      }
    })

const doctorRunner =
  (available: Readonly<Record<string, boolean>>): DoctorCommandRunner =>
  (invocation) =>
    available[invocation.command] === true
      ? Effect.succeed({ stdout: `${invocation.command} ok`, stderr: "" })
      : Effect.fail(
          new DoctorMissing({
            probe: invocation.probe,
            component: invocation.command,
            platform: "test",
            message: `${invocation.command} missing`,
            remediation: `install ${invocation.command}`,
            installHint: `install ${invocation.command}`,
            docsUrl: "https://example.invalid"
          })
        )

const fixedClock = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => {
    const value = values[index] ?? values[values.length - 1]
    index += 1
    return value ?? 0
  }
}

const fixedEffectClock = (values: readonly number[]): Clock.Clock => {
  const now = fixedClock(values)
  return {
    currentTimeMillisUnsafe: now,
    currentTimeMillis: Effect.sync(now),
    currentTimeNanosUnsafe: () => BigInt(now()) * 1_000_000n,
    currentTimeNanos: Effect.sync(() => BigInt(now()) * 1_000_000n),
    sleep: () => Effect.yieldNow
  }
}
