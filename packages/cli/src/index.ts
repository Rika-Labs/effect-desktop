import { mkdir, readdir, rm, stat, writeFile, copyFile } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { HOST_PROTOCOL_VERSION } from "@effect-desktop/bridge"
import {
  Console,
  Data,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Sink,
  Stdio,
  Terminal
} from "effect"
import { Command, Flag } from "effect/unstable/cli"
import * as ChildProcessSpawnerModule from "effect/unstable/process"

import {
  formatProductionCheckReport,
  runProductionCheck,
  type ProductionCheckFile,
  type ProductionSecurityConfig
} from "@effect-desktop/config"

import {
  runDesktopPackage,
  runPackageCommand,
  type DesktopPackageReport,
  type PackageCommandRunner,
  type PackagePipelineError,
  PackageCommandFailedError,
  PackageConfigError,
  PackageFileError,
  PackageUnsupportedArtifactError,
  PackageUnsupportedHostError,
  PackageUnsupportedTargetError
} from "./package-pipeline.js"
import {
  formatDoctorReport,
  runDesktopDoctor,
  runDoctorCommand,
  type DoctorCommandRunner
} from "./doctor.js"
import {
  formatReproError,
  formatReproReport,
  runDesktopReproCheck
} from "./reproducible-build-check.js"
import {
  runDesktopSign,
  runSignCommand,
  SignCommandFailedError,
  SignConfigError,
  SignFileError,
  SignUnsupportedHostError,
  SignUnsupportedTargetError,
  type DesktopSignReport,
  type SignCommandRunner,
  type SignPipelineError
} from "./signing-pipeline.js"
import {
  runDesktopNotarize,
  runNotarizeCommand,
  NotarizeCommandFailedError,
  NotarizeConfigError,
  NotarizeFileError,
  NotarizeUnsupportedHostError,
  NotarizeUnsupportedTargetError,
  type DesktopNotarizeReport,
  type NotarizeCommandRunner,
  type NotarizePipelineError
} from "./notarization-pipeline.js"
import {
  runDesktopPublish,
  PublishConfigError,
  PublishFileError,
  PublishSignatureError,
  type DesktopPublishReport,
  type PublishPipelineError
} from "./update-manifest.js"
import {
  formatPublicApiError,
  formatPublicApiReport,
  runPublicApiCheck
} from "./public-api-snapshot.js"
import {
  formatDocsReleaseGateError,
  formatDocsReleaseGateReport,
  runDocsReleaseGate
} from "./docs-release-gate.js"
import { formatReleaseGateError, formatReleaseGateReport, runReleaseGate } from "./release-gate.js"
import {
  formatAccessibilityGateError,
  formatAccessibilityGateReport,
  runAccessibilityGate
} from "./accessibility-gate.js"
import { formatSemverGuardError, formatSemverGuardReport, runSemverGuard } from "./semver-guard.js"

export {
  runDesktopPackage,
  type DesktopPackageOptions,
  type DesktopPackageReport,
  type PackageArtifactKind,
  type PackageArtifactReport,
  type PackageCommandInvocation,
  type PackageCommandRunner,
  type PackagePipelineError,
  type PackageStepName,
  type PackageStepReport,
  type PackageTarget
} from "./package-pipeline.js"
export {
  DoctorMissing,
  runDesktopDoctor,
  type DesktopDoctorReport,
  type DoctorCommandInvocation,
  type DoctorCommandOutput,
  type DoctorCommandRunner,
  type DoctorProbeName,
  type DoctorProbeResult,
  type DoctorProbeStatus
} from "./doctor.js"
export {
  runDesktopReproCheck,
  type DesktopReproReport,
  type ReproCheckError,
  type ReproDifference
} from "./reproducible-build-check.js"
export {
  runDesktopSign,
  type DesktopSignOptions,
  type DesktopSignReport,
  type SignArtifactKind,
  type SignArtifactReport,
  type SignCommandInvocation,
  type SignCommandRunner,
  type SignPipelineError,
  type SignStepName,
  type SignStepReport,
  type SignTarget
} from "./signing-pipeline.js"
export {
  runDesktopNotarize,
  type DesktopNotarizeOptions,
  type DesktopNotarizeReport,
  type NotarizeArtifactKind,
  type NotarizeArtifactReport,
  type NotarizeCommandInvocation,
  type NotarizeCommandOutput,
  type NotarizeCommandRunner,
  type NotarizePipelineError,
  type NotarizeStepName,
  type NotarizeStepReport,
  type NotarizeTarget
} from "./notarization-pipeline.js"
export {
  canonicalUpdateManifestBytes,
  runDesktopPublish,
  type DesktopPublishOptions,
  type DesktopPublishReport,
  type PublishArtifactKind,
  type PublishChannel,
  type PublishPipelineError,
  type PublishTarget,
  type UpdateArtifactManifest,
  type UpdateManifest
} from "./update-manifest.js"
export {
  runPublicApiCheck,
  type PublicApiChange,
  type PublicApiChangeKind,
  type PublicApiPackageSnapshot,
  type PublicApiSnapshotError,
  type PublicApiSnapshotFile,
  type PublicApiSnapshotOptions,
  type PublicApiSnapshotReport,
  type PublicApiSymbolKind,
  type PublicApiSymbolSnapshot
} from "./public-api-snapshot.js"
export {
  runDocsReleaseGate,
  type DocsExampleInvocation,
  type DocsExampleReport,
  type DocsExampleRunner,
  type DocsGateExampleFailedError,
  type DocsGateFileError,
  type DocsGateManifestError,
  type DocsGateMissingPageError,
  type DocsManifest,
  type DocsManifestPage,
  type DocsPageReport,
  type DocsReleaseGateError,
  type DocsReleaseGateOptions,
  type DocsReleaseGateReport
} from "./docs-release-gate.js"
export {
  runReleaseGate,
  type ReleaseChecklist,
  type ReleaseChecklistGate,
  type ReleaseGateCheckReport,
  type ReleaseGateError,
  type ReleaseGateEvidenceError,
  type ReleaseGateEvidenceKind,
  type ReleaseGateFileError,
  type ReleaseGateManifestError,
  type ReleaseGateOptions,
  type ReleaseGateReport
} from "./release-gate.js"
export {
  runAccessibilityGate,
  type AccessibilityAuditMode,
  type AccessibilityContrastPair,
  type AccessibilityGateError,
  type AccessibilityGateEvidenceError,
  type AccessibilityGateFileError,
  type AccessibilityGateManifestError,
  type AccessibilityGateOptions,
  type AccessibilityGateReport,
  type AccessibilityManifest,
  type AccessibilityRequiredToken,
  type AccessibilityTemplate,
  type AccessibilityTemplateReport
} from "./accessibility-gate.js"
export {
  runSemverGuard,
  type SemverApiChange,
  type SemverChangeClassification,
  type SemverGuardError,
  type SemverGuardFileError,
  type SemverGuardManifestError,
  type SemverGuardOptions,
  type SemverGuardPolicyError,
  type SemverGuardReport,
  type SemverPolicyManifest,
  type SemverReleaseKind
} from "./semver-guard.js"

export class CliUsageError extends Error {
  public override readonly name = "CliUsageError"
}

export class BuildConfigError extends Data.TaggedError("BuildConfigError")<{
  readonly field: string
  readonly message: string
}> {}

export class BuildUnsupportedTargetError extends Data.TaggedError("BuildUnsupportedTargetError")<{
  readonly target: string
  readonly hostTarget: BuildTarget
  readonly message: string
  readonly remediation: string
}> {}

export class BuildUnsupportedHostError extends Data.TaggedError("BuildUnsupportedHostError")<{
  readonly platform: string
  readonly arch: string
  readonly message: string
  readonly remediation: string
}> {}

export class BuildCommandFailedError extends Data.TaggedError("BuildCommandFailedError")<{
  readonly step: BuildStepName
  readonly command: readonly string[]
  readonly cwd: string
  readonly exitCode: number | undefined
  readonly message: string
}> {}

export class BuildFileError extends Data.TaggedError("BuildFileError")<{
  readonly operation: string
  readonly path: string
  readonly message: string
  readonly cause: unknown
}> {}

export type BuildPipelineError =
  | BuildConfigError
  | BuildUnsupportedHostError
  | BuildUnsupportedTargetError
  | BuildCommandFailedError
  | BuildFileError

export type BuildOs = "linux" | "macos" | "windows"
export type BuildArch = "arm64" | "x64"
export type BuildTarget = `${BuildOs}-${BuildArch}`
export type BuildStepName = "renderer" | "runtime" | "native-host" | "bridge" | "manifest"

export interface CliRunOptions {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly writeStdout: (text: string) => void
  readonly writeStderr: (text: string) => void
  readonly commandRunner?: CommandRunner
  readonly packageCommandRunner?: PackageCommandRunner
  readonly doctorCommandRunner?: DoctorCommandRunner
  readonly signCommandRunner?: SignCommandRunner
  readonly notarizeCommandRunner?: NotarizeCommandRunner
  readonly now?: () => number
  readonly hostTarget?: BuildTarget
  readonly platform?: NodeJS.Platform
  readonly arch?: string
  readonly bunVersion?: string
}

export interface CommandInvocation {
  readonly step: BuildStepName
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}

export type CommandRunner = (
  invocation: CommandInvocation
) => Effect.Effect<void, BuildCommandFailedError, never>

export interface BuildStepReport {
  readonly name: BuildStepName
  readonly command?: readonly string[]
  readonly cwd?: string
  readonly elapsedMs: number
  readonly outputPath: string
}

export interface DesktopBuildReport {
  readonly appId: string
  readonly appName: string
  readonly appVersion: string
  readonly target: BuildTarget
  readonly layoutPath: string
  readonly appManifestPath: string
  readonly bridgeManifestPath: string
  readonly steps: readonly BuildStepReport[]
}

export interface DesktopBuildOptions {
  readonly cwd: string
  readonly configPath: string
  readonly platform: string | undefined
  readonly commandRunner: CommandRunner
  readonly now: () => number
  readonly hostTarget: BuildTarget | undefined
}

interface BuildPlan {
  readonly appId: string
  readonly appName: string
  readonly appVersion: string
  readonly appRoot: string
  readonly configPath: string
  readonly rendererDistPath: string
  readonly runtimeEntryPath: string
  readonly layoutPath: string
  readonly target: BuildTarget
}

interface AppConfig {
  readonly app?: {
    readonly id?: unknown
    readonly name?: unknown
    readonly version?: unknown
  }
  readonly runtime?: {
    readonly entry?: unknown
  }
  readonly renderer?: {
    readonly dist?: unknown
  }
}

export const runCli = (options: CliRunOptions): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    const exitCodeRef = yield* Ref.make(0)

    const fail = (code: number): Effect.Effect<void, never, never> => Ref.set(exitCodeRef, code)

    const buildCmd = Command.make(
      "build",
      {
        config: Flag.string("config").pipe(Flag.withDefault("desktop.config.ts")),
        platform: Flag.optional(Flag.string("platform")),
        json: Flag.boolean("json").pipe(Flag.withDefault(false))
      },
      (flags) =>
        Effect.gen(function* () {
          const report = yield* runDesktopBuild({
            cwd: options.cwd,
            configPath: flags.config,
            platform: Option.getOrUndefined(flags.platform),
            commandRunner: options.commandRunner ?? runCommand,
            now: options.now ?? Date.now,
            hostTarget: options.hostTarget
          }).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                if (flags.json) {
                  options.writeStderr(`${JSON.stringify(formatBuildError(error), null, 2)}\n`)
                } else {
                  options.writeStderr(`${formatBuildErrorText(error)}\n`)
                }
                return undefined
              })
            )
          )
          if (report === undefined) {
            yield* fail(1)
            return
          }
          if (flags.json) {
            options.writeStdout(`${JSON.stringify(report, null, 2)}\n`)
          } else {
            options.writeStdout(formatBuildReport(report))
          }
        })
    ).pipe(
      Command.withDescription(
        "Build renderer, runtime, native host, bridge manifest, and app manifest into build/effect-desktop/<target>."
      )
    )

    const packageCmd = Command.make(
      "package",
      {
        config: Flag.string("config").pipe(Flag.withDefault("desktop.config.ts")),
        platform: Flag.optional(Flag.string("platform")),
        artifact: Flag.optional(Flag.string("artifact")),
        json: Flag.boolean("json").pipe(Flag.withDefault(false))
      },
      (flags) =>
        Effect.gen(function* () {
          const report = yield* runDesktopPackage({
            cwd: options.cwd,
            configPath: flags.config,
            platform: Option.getOrUndefined(flags.platform),
            artifact: Option.getOrUndefined(flags.artifact),
            commandRunner: options.packageCommandRunner ?? runPackageCommand,
            now: options.now ?? Date.now,
            hostTarget: options.hostTarget
          }).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                if (flags.json) {
                  options.writeStderr(`${JSON.stringify(formatPackageError(error), null, 2)}\n`)
                } else {
                  options.writeStderr(`${formatPackageErrorText(error)}\n`)
                }
                return undefined
              })
            )
          )
          if (report === undefined) {
            yield* fail(1)
            return
          }
          if (flags.json) {
            options.writeStdout(`${JSON.stringify(report, null, 2)}\n`)
          } else {
            options.writeStdout(formatPackageReport(report))
          }
        })
    ).pipe(
      Command.withDescription(
        "Package an existing build/effect-desktop/<target> layout into the fixed §23.2 artifact set."
      )
    )

    const signCmd = Command.make(
      "sign",
      {
        config: Flag.string("config").pipe(Flag.withDefault("desktop.config.ts")),
        platform: Flag.optional(Flag.string("platform")),
        json: Flag.boolean("json").pipe(Flag.withDefault(false))
      },
      (flags) =>
        Effect.gen(function* () {
          const report = yield* runDesktopSign({
            cwd: options.cwd,
            configPath: flags.config,
            platform: Option.getOrUndefined(flags.platform),
            commandRunner: options.signCommandRunner ?? runSignCommand,
            now: options.now ?? Date.now,
            hostTarget: options.hostTarget
          }).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                if (flags.json) {
                  options.writeStderr(`${JSON.stringify(formatSignError(error), null, 2)}\n`)
                } else {
                  options.writeStderr(`${formatSignErrorText(error)}\n`)
                }
                return undefined
              })
            )
          )
          if (report === undefined) {
            yield* fail(1)
            return
          }
          if (flags.json) {
            options.writeStdout(`${JSON.stringify(report, null, 2)}\n`)
          } else {
            options.writeStdout(formatSignReport(report))
          }
        })
    ).pipe(
      Command.withDescription(
        "Sign existing dist/desktop/<platform> artifacts and write sign-report.json."
      )
    )

    const notarizeCmd = Command.make(
      "notarize",
      {
        config: Flag.string("config").pipe(Flag.withDefault("desktop.config.ts")),
        platform: Flag.optional(Flag.string("platform")),
        json: Flag.boolean("json").pipe(Flag.withDefault(false))
      },
      (flags) =>
        Effect.gen(function* () {
          const macosTarget =
            options.hostTarget === "macos-arm64" || options.hostTarget === "macos-x64"
              ? options.hostTarget
              : undefined
          const report = yield* runDesktopNotarize({
            cwd: options.cwd,
            configPath: flags.config,
            platform: Option.getOrUndefined(flags.platform),
            commandRunner: options.notarizeCommandRunner ?? runNotarizeCommand,
            now: options.now ?? Date.now,
            hostTarget: macosTarget
          }).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                if (flags.json) {
                  options.writeStderr(`${JSON.stringify(formatNotarizeError(error), null, 2)}\n`)
                } else {
                  options.writeStderr(`${formatNotarizeErrorText(error)}\n`)
                }
                return undefined
              })
            )
          )
          if (report === undefined) {
            yield* fail(1)
            return
          }
          if (flags.json) {
            options.writeStdout(`${JSON.stringify(report, null, 2)}\n`)
          } else {
            options.writeStdout(formatNotarizeReport(report))
          }
        })
    ).pipe(
      Command.withDescription(
        "Submit signed macOS artifacts to Apple notarization, staple tickets, and assess Gatekeeper."
      )
    )

    const publishCmd = Command.make(
      "publish",
      {
        config: Flag.string("config").pipe(Flag.withDefault("desktop.config.ts")),
        platform: Flag.optional(Flag.string("platform")),
        json: Flag.boolean("json").pipe(Flag.withDefault(false))
      },
      (flags) =>
        Effect.gen(function* () {
          const report = yield* runDesktopPublish({
            cwd: options.cwd,
            configPath: flags.config,
            platform: Option.getOrUndefined(flags.platform),
            now: options.now ?? Date.now
          }).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                if (flags.json) {
                  options.writeStderr(`${JSON.stringify(formatPublishError(error), null, 2)}\n`)
                } else {
                  options.writeStderr(`${formatPublishErrorText(error)}\n`)
                }
                return undefined
              })
            )
          )
          if (report === undefined) {
            yield* fail(1)
            return
          }
          if (flags.json) {
            options.writeStdout(`${JSON.stringify(report, null, 2)}\n`)
          } else {
            options.writeStdout(formatPublishReport(report))
          }
        })
    ).pipe(
      Command.withDescription(
        "Publish an Ed25519-signed update-manifest.json from packaged release artifacts."
      )
    )

    const doctorCmd = Command.make(
      "doctor",
      {
        config: Flag.optional(Flag.string("config")),
        ci: Flag.boolean("ci").pipe(Flag.withDefault(false)),
        json: Flag.boolean("json").pipe(Flag.withDefault(false))
      },
      (flags) =>
        Effect.gen(function* () {
          const report = yield* runDesktopDoctor({
            cwd: options.cwd,
            configPath: Option.getOrUndefined(flags.config),
            ci: flags.ci,
            platform: options.platform ?? process.platform,
            arch: options.arch ?? process.arch,
            bunVersion: options.bunVersion ?? Bun.version,
            commandRunner: options.doctorCommandRunner ?? runDoctorCommand
          })
          if (flags.json) {
            if (report.passed) {
              options.writeStdout(`${JSON.stringify(report, null, 2)}\n`)
            } else {
              options.writeStderr(`${JSON.stringify(report, null, 2)}\n`)
            }
          } else if (report.passed) {
            options.writeStdout(formatDoctorReport(report))
          } else {
            options.writeStderr(formatDoctorReport(report))
          }
          if (!report.passed) {
            yield* fail(1)
          }
        })
    ).pipe(
      Command.withDescription(
        "Validate Bun, Rust, platform SDK, WebView runtime, signing credentials, build tools, package manager state, native host cache, and desktop config."
      )
    )

    const checkCmd = Command.make(
      "check",
      {
        production: Flag.boolean("production").pipe(Flag.withDefault(false)),
        repro: Flag.boolean("repro").pipe(Flag.withDefault(false)),
        api: Flag.boolean("api").pipe(Flag.withDefault(false)),
        docs: Flag.boolean("docs").pipe(Flag.withDefault(false)),
        release: Flag.boolean("release").pipe(Flag.withDefault(false)),
        a11y: Flag.boolean("a11y").pipe(Flag.withDefault(false)),
        semver: Flag.boolean("semver").pipe(Flag.withDefault(false)),
        config: Flag.optional(Flag.string("config")),
        renderer: Flag.optional(Flag.string("renderer")),
        platform: Flag.optional(Flag.string("platform")),
        artifact: Flag.optional(Flag.string("artifact")),
        write: Flag.boolean("write").pipe(Flag.withDefault(false)),
        json: Flag.boolean("json").pipe(Flag.withDefault(false))
      },
      (flags) =>
        Effect.gen(function* () {
          if (flags.repro) {
            yield* runReproCheckHandler(flags, options, fail)
          } else if (flags.api) {
            yield* runApiCheckHandler(flags, options, fail)
          } else if (flags.docs) {
            yield* runDocsCheckHandler(flags, options, fail)
          } else if (flags.release) {
            yield* runReleaseCheckHandler(flags, options, fail)
          } else if (flags.a11y) {
            yield* runA11yCheckHandler(flags, options, fail)
          } else if (flags.semver) {
            yield* runSemverCheckHandler(flags, options, fail)
          } else if (flags.production) {
            yield* runProductionCheckHandler(flags, options, fail)
          } else {
            options.writeStderr(
              "Usage: desktop check --production --config <path>\n" +
                "       desktop check --repro --config <path>\n" +
                "       desktop check --api [--write]\n" +
                "       desktop check --docs\n" +
                "       desktop check --release\n" +
                "       desktop check --a11y\n" +
                "       desktop check --semver\n"
            )
            yield* fail(1)
          }
        })
    ).pipe(
      Command.withDescription(
        "Run production security, reproducibility, public API, docs, release, accessibility, or semver checks."
      )
    )

    const desktopCmd = Command.make("desktop").pipe(
      Command.withSubcommands([
        buildCmd,
        packageCmd,
        signCmd,
        notarizeCmd,
        publishCmd,
        doctorCmd,
        checkCmd
      ])
    )

    const cliLayer = makeCliLayer(options)

    yield* Command.runWith(desktopCmd, { version: "0.0.0" })(options.argv).pipe(
      Effect.catch(() => fail(1)),
      Effect.provide(cliLayer)
    )

    return yield* Ref.get(exitCodeRef)
  })

export const runDesktopBuild = (
  options: DesktopBuildOptions
): Effect.Effect<DesktopBuildReport, BuildPipelineError, never> =>
  Effect.gen(function* () {
    const absoluteConfigPath = resolvePath(options.cwd, options.configPath)
    const rawConfig = yield* loadConfig(absoluteConfigPath)
    const hostTarget = yield* resolveHostTarget(options.hostTarget)
    const target = yield* resolveBuildTarget(options.platform, hostTarget)
    const plan = yield* normalizeBuildPlan(rawConfig, {
      configPath: absoluteConfigPath,
      hostTarget,
      workspaceRoot: options.cwd,
      target
    })

    yield* removePath(plan.layoutPath)
    yield* makeDirectory(plan.layoutPath)

    const renderer = yield* runStep(options, plan, {
      name: "renderer",
      command: "bun",
      args: ["run", "build"],
      cwd: plan.appRoot,
      outputPath: join(plan.layoutPath, "renderer")
    })
    yield* copyDirectory(plan.rendererDistPath, renderer.outputPath)

    const runtime = yield* runStep(options, plan, {
      name: "runtime",
      command: "bun",
      args: [
        "build",
        plan.runtimeEntryPath,
        "--target=bun",
        "--outdir",
        join(plan.layoutPath, "runtime")
      ],
      cwd: options.cwd,
      outputPath: join(plan.layoutPath, "runtime")
    })

    const nativeHost = yield* runStep(options, plan, {
      name: "native-host",
      command: "cargo",
      args: ["build", "-p", "host", "--release"],
      cwd: options.cwd,
      outputPath: join(plan.layoutPath, "native", hostBinaryName(target))
    })
    yield* makeDirectory(dirname(nativeHost.outputPath))
    yield* copyFileEffect(hostBuildOutputPath(options.cwd, target), nativeHost.outputPath)

    const bridge = yield* writeBridgeManifest(plan, options.now)
    const manifest = yield* writeAppManifest(plan)
    const report = newBuildReport(plan, [renderer, runtime, nativeHost, bridge, manifest])
    yield* writeJson(join(plan.layoutPath, "build-report.json"), report)

    return report
  })

const runStep = (
  options: DesktopBuildOptions,
  _plan: BuildPlan,
  step: Omit<BuildStepReport, "elapsedMs" | "command" | "cwd"> & {
    readonly command: string
    readonly args: readonly string[]
    readonly cwd: string
  }
): Effect.Effect<BuildStepReport, BuildCommandFailedError, never> =>
  Effect.gen(function* () {
    const start = options.now()
    yield* options.commandRunner({
      step: step.name,
      command: step.command,
      args: step.args,
      cwd: step.cwd
    })
    const elapsedMs = Math.max(0, options.now() - start)
    return {
      name: step.name,
      command: [step.command, ...step.args],
      cwd: step.cwd,
      elapsedMs,
      outputPath: step.outputPath
    }
  })

const normalizeBuildPlan = (
  rawConfig: unknown,
  options: {
    readonly configPath: string
    readonly hostTarget: BuildTarget
    readonly workspaceRoot: string
    readonly target: BuildTarget
  }
): Effect.Effect<BuildPlan, BuildConfigError | BuildUnsupportedTargetError, never> =>
  Effect.gen(function* () {
    const config = yield* readConfigObject(rawConfig)
    const appRoot = dirname(options.configPath)
    const appId = yield* readSafeAppId(config.app?.id, "app.id")
    const appName = yield* readRequiredString(config.app?.name, "app.name")
    const appVersion = yield* readSemverString(config.app?.version, "app.version")
    const rendererDist =
      (yield* readOptionalString(config.renderer?.dist, "renderer.dist")) ?? "dist"
    const runtimeEntry = yield* readRequiredString(config.runtime?.entry, "runtime.entry")
    const runtimeEntryPath = resolvePath(appRoot, runtimeEntry)

    return {
      appId,
      appName,
      appVersion,
      appRoot,
      configPath: options.configPath,
      rendererDistPath: resolvePath(appRoot, rendererDist),
      runtimeEntryPath,
      layoutPath: resolvePath(appRoot, join("build", "effect-desktop", options.target)),
      target: options.target
    }
  })

const readConfigObject = (rawConfig: unknown): Effect.Effect<AppConfig, BuildConfigError, never> =>
  isRecord(rawConfig)
    ? Effect.succeed(rawConfig as AppConfig)
    : Effect.fail(
        new BuildConfigError({
          field: "default",
          message: "desktop config must export an object"
        })
      )

const readRequiredString = (
  value: unknown,
  field: string
): Effect.Effect<string, BuildConfigError, never> => {
  if (typeof value === "string" && value.length > 0) {
    return Effect.succeed(value)
  }

  return Effect.fail(new BuildConfigError({ field, message: `${field} is required` }))
}

const readOptionalString = (
  value: unknown,
  field: string
): Effect.Effect<string | undefined, BuildConfigError, never> => {
  if (value === undefined) {
    return Effect.succeed(undefined)
  }
  if (typeof value === "string" && value.length > 0) {
    return Effect.succeed(value)
  }
  return Effect.fail(
    new BuildConfigError({ field, message: `${field} must be a non-empty string` })
  )
}

const resolveBuildTarget = (
  requested: string | undefined,
  hostTarget: BuildTarget
): Effect.Effect<BuildTarget, BuildUnsupportedTargetError, never> => {
  const target = requested ?? hostTarget
  if (!isBuildTarget(target)) {
    return Effect.fail(
      new BuildUnsupportedTargetError({
        target,
        hostTarget,
        message: `unsupported build target ${target}`,
        remediation:
          "Run `bun desktop doctor` on a supported host and choose the matching --platform."
      })
    )
  }
  if (target !== hostTarget) {
    return Effect.fail(
      new BuildUnsupportedTargetError({
        target,
        hostTarget,
        message: `target ${target} does not match host ${hostTarget}`,
        remediation:
          "Cross-platform outputs are out of scope for this build slice. Run `bun desktop doctor` on the matching host or use the default target."
      })
    )
  }

  return Effect.succeed(target)
}

export const detectHostTarget = (): BuildTarget | undefined => {
  const os = process.platform === "darwin" ? "macos" : process.platform
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : undefined
  if ((os === "linux" || os === "macos" || os === "win32") && arch !== undefined) {
    return `${os === "win32" ? "windows" : os}-${arch}` as BuildTarget
  }
  return undefined
}

const resolveHostTarget = (
  override: BuildTarget | undefined
): Effect.Effect<BuildTarget, BuildUnsupportedHostError, never> => {
  const hostTarget = override ?? detectHostTarget()
  if (hostTarget !== undefined) {
    return Effect.succeed(hostTarget)
  }

  return Effect.fail(
    new BuildUnsupportedHostError({
      platform: process.platform,
      arch: process.arch,
      message: `unsupported host ${process.platform}-${process.arch}`,
      remediation: "Run `bun desktop doctor` on linux, macOS, or Windows with x64 or arm64."
    })
  )
}

const isBuildTarget = (value: string): value is BuildTarget =>
  value === "linux-x64" ||
  value === "linux-arm64" ||
  value === "macos-x64" ||
  value === "macos-arm64" ||
  value === "windows-x64" ||
  value === "windows-arm64"

const runCommand: CommandRunner = (invocation) =>
  Effect.tryPromise({
    try: async () => {
      const process = Bun.spawn([invocation.command, ...invocation.args], {
        cwd: invocation.cwd,
        stdout: "ignore",
        stderr: "ignore"
      })
      const exitCode = await process.exited
      if (exitCode !== 0) {
        throw new BuildCommandFailedError({
          step: invocation.step,
          command: [invocation.command, ...invocation.args],
          cwd: invocation.cwd,
          exitCode,
          message: `${invocation.step} command exited with ${exitCode}`
        })
      }
    },
    catch: (cause) =>
      cause instanceof BuildCommandFailedError
        ? cause
        : new BuildCommandFailedError({
            step: invocation.step,
            command: [invocation.command, ...invocation.args],
            cwd: invocation.cwd,
            exitCode: undefined,
            message: formatUnknownError(cause)
          })
  })

const writeBridgeManifest = (
  plan: BuildPlan,
  now: () => number
): Effect.Effect<BuildStepReport, BuildFileError, never> =>
  Effect.gen(function* () {
    const start = now()
    const path = join(plan.layoutPath, "bridge", "bridge-manifest.json")
    yield* writeJson(path, {
      protocolVersion: HOST_PROTOCOL_VERSION,
      generatedAt: new Date(0).toISOString(),
      apiContracts: [],
      errorRegistryHash: HOST_PROTOCOL_VERSION
    })
    return {
      name: "bridge",
      elapsedMs: Math.max(0, now() - start),
      outputPath: path
    }
  })

const writeAppManifest = (plan: BuildPlan): Effect.Effect<BuildStepReport, BuildFileError, never> =>
  Effect.gen(function* () {
    const path = join(plan.layoutPath, "app-manifest.json")
    const runtimeBase = basename(plan.runtimeEntryPath)
    const runtimeEntry =
      extname(runtimeBase) === ".ts" || extname(runtimeBase) === ".tsx"
        ? `${runtimeBase.slice(0, -extname(runtimeBase).length)}.js`
        : runtimeBase
    yield* writeJson(path, {
      id: plan.appId,
      name: plan.appName,
      version: plan.appVersion,
      target: plan.target,
      renderer: {
        assetBaseUrl: "app://localhost/",
        path: "renderer"
      },
      runtime: {
        engine: "bun",
        entry: `runtime/${runtimeEntry}`
      },
      nativeHost: {
        binary: `native/${hostBinaryName(plan.target)}`
      },
      bridge: {
        manifest: "bridge/bridge-manifest.json"
      }
    })
    return {
      name: "manifest",
      elapsedMs: 0,
      outputPath: path
    }
  })

const newBuildReport = (
  plan: BuildPlan,
  steps: readonly BuildStepReport[]
): DesktopBuildReport => ({
  appId: plan.appId,
  appName: plan.appName,
  appVersion: plan.appVersion,
  target: plan.target,
  layoutPath: plan.layoutPath,
  appManifestPath: join(plan.layoutPath, "app-manifest.json"),
  bridgeManifestPath: join(plan.layoutPath, "bridge", "bridge-manifest.json"),
  steps
})

const formatBuildReport = (report: DesktopBuildReport): string =>
  [
    "Effect Desktop build",
    `app               ${report.appId}`,
    `target            ${report.target}`,
    `layout            ${report.layoutPath}`,
    ...report.steps.map(
      (step) =>
        `${step.name.padEnd(17)} ${step.elapsedMs.toString().padStart(4)}ms ${step.outputPath}`
    ),
    ""
  ].join("\n")

const formatBuildError = (
  error: BuildPipelineError
): { readonly tag: string; readonly message: string; readonly remediation?: string } => {
  if (error instanceof BuildUnsupportedTargetError) {
    return { tag: error._tag, message: error.message, remediation: error.remediation }
  }
  if (error instanceof BuildUnsupportedHostError) {
    return { tag: error._tag, message: error.message, remediation: error.remediation }
  }
  if (error instanceof BuildCommandFailedError) {
    return { tag: error._tag, message: error.message }
  }
  if (error instanceof BuildFileError) {
    return { tag: error._tag, message: error.message }
  }
  if (error instanceof BuildConfigError) {
    return { tag: error._tag, message: error.message }
  }

  return { tag: "UnknownBuildError", message: "unknown build error" }
}

const formatBuildErrorText = (error: BuildPipelineError): string => {
  const formatted = formatBuildError(error)
  return formatted.remediation === undefined
    ? `${formatted.tag}: ${formatted.message}`
    : `${formatted.tag}: ${formatted.message}\nNext: ${formatted.remediation}`
}

const formatPackageReport = (report: DesktopPackageReport): string =>
  [
    "Effect Desktop package",
    `app               ${report.appId}`,
    `target            ${report.target}`,
    `output            ${report.outputPath}`,
    ...report.artifacts.map(
      (artifact) =>
        `${artifact.kind.padEnd(17)} ${artifact.sizeBytes.toString().padStart(4)}b ${artifact.artifactPath}`
    ),
    ""
  ].join("\n")

const formatPackageError = (
  error: PackagePipelineError
): { readonly tag: string; readonly message: string; readonly remediation?: string } => {
  if (error instanceof PackageUnsupportedTargetError) {
    return { tag: error._tag, message: error.message, remediation: error.remediation }
  }
  if (error instanceof PackageUnsupportedHostError) {
    return { tag: error._tag, message: error.message, remediation: error.remediation }
  }
  if (error instanceof PackageUnsupportedArtifactError) {
    return { tag: error._tag, message: error.message, remediation: error.remediation }
  }
  if (error instanceof PackageCommandFailedError) {
    return {
      tag: error._tag,
      message:
        error.stderr === undefined || error.stderr.length === 0
          ? error.message
          : `${error.message}\n${error.stderr}`
    }
  }
  if (error instanceof PackageConfigError) {
    return { tag: error._tag, message: error.message }
  }
  if (error instanceof PackageFileError) {
    return { tag: error._tag, message: error.message }
  }
  return { tag: "UnknownPackageError", message: "unknown package error" }
}

const formatPackageErrorText = (error: PackagePipelineError): string => {
  const formatted = formatPackageError(error)
  return formatted.remediation === undefined
    ? `${formatted.tag}: ${formatted.message}`
    : `${formatted.tag}: ${formatted.message}\nNext: ${formatted.remediation}`
}

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u

const isContainedFileName = (value: string): boolean => {
  if (value === "." || value === "..") {
    return false
  }
  if (value.includes("/") || value.includes("\\")) {
    return false
  }
  if (isAbsolute(value)) {
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

const appIdMatch = (value: string): boolean =>
  /^([a-zA-Z][a-zA-Z0-9-]*)(\.[a-zA-Z][a-zA-Z0-9-]*)+$/.test(value) && isContainedFileName(value)

const readSafeAppId = (
  value: unknown,
  field: string
): Effect.Effect<string, BuildConfigError, never> =>
  readRequiredString(value, field).pipe(
    Effect.flatMap((appId) =>
      appIdMatch(appId)
        ? Effect.succeed(appId)
        : Effect.fail(
            new BuildConfigError({
              field,
              message: `${field} must be a reverse-DNS ASCII identifier`
            })
          )
    )
  )

const readSemverString = (
  value: unknown,
  field: string
): Effect.Effect<string, BuildConfigError, never> =>
  readRequiredString(value, field).pipe(
    Effect.flatMap((version) =>
      SEMVER_PATTERN.test(version)
        ? Effect.succeed(version)
        : Effect.fail(
            new BuildConfigError({ field, message: `${field} must be a SemVer X.Y.Z string` })
          )
    )
  )

const formatSignReport = (report: DesktopSignReport): string =>
  [
    "Effect Desktop sign",
    `app               ${report.appId}`,
    `target            ${report.target}`,
    `output            ${report.outputPath}`,
    ...report.artifacts.map(
      (artifact) =>
        `${artifact.kind.padEnd(17)} ${artifact.signedPaths.length
          .toString()
          .padStart(4)} paths ${artifact.artifactPath}`
    ),
    ""
  ].join("\n")

const formatSignError = (
  error: SignPipelineError
): { readonly tag: string; readonly message: string; readonly remediation?: string } => {
  if (error instanceof SignUnsupportedTargetError) {
    return { tag: error._tag, message: error.message, remediation: error.remediation }
  }
  if (error instanceof SignUnsupportedHostError) {
    return { tag: error._tag, message: error.message, remediation: error.remediation }
  }
  if (error instanceof SignCommandFailedError) {
    return {
      tag: error._tag,
      message:
        error.stderr === undefined || error.stderr.length === 0
          ? error.message
          : `${error.message}\n${error.stderr}`
    }
  }
  if (error instanceof SignFileError) {
    return { tag: error._tag, message: error.message }
  }
  if (error instanceof SignConfigError) {
    return { tag: error._tag, message: error.message, remediation: error.remediation }
  }

  return { tag: "UnknownSignError", message: "unknown sign error" }
}

const formatSignErrorText = (error: SignPipelineError): string => {
  const formatted = formatSignError(error)
  return formatted.remediation === undefined
    ? `${formatted.tag}: ${formatted.message}`
    : `${formatted.tag}: ${formatted.message}\nNext: ${formatted.remediation}`
}

const formatNotarizeReport = (report: DesktopNotarizeReport): string =>
  [
    "Effect Desktop notarize",
    `app               ${report.appId}`,
    `target            ${report.target}`,
    `output            ${report.outputPath}`,
    ...report.artifacts.map(
      (artifact) =>
        `${artifact.kind.padEnd(17)} ${artifact.alreadyStapled ? "already-stapled" : (artifact.status ?? "submitted")} ${artifact.artifactPath}`
    ),
    ""
  ].join("\n")

const formatNotarizeError = (
  error: NotarizePipelineError
): { readonly tag: string; readonly message: string; readonly remediation?: string } => {
  if (error instanceof NotarizeUnsupportedTargetError) {
    return { tag: error._tag, message: error.message, remediation: error.remediation }
  }
  if (error instanceof NotarizeUnsupportedHostError) {
    return { tag: error._tag, message: error.message, remediation: error.remediation }
  }
  if (error instanceof NotarizeCommandFailedError) {
    const output = [error.stdout, error.stderr].filter(
      (value): value is string => value !== undefined && value.length > 0
    )
    return {
      tag: error._tag,
      message: output.length === 0 ? error.message : `${error.message}\n${output.join("\n")}`
    }
  }
  if (error instanceof NotarizeFileError) {
    return { tag: error._tag, message: error.message }
  }
  if (error instanceof NotarizeConfigError) {
    return { tag: error._tag, message: error.message, remediation: error.remediation }
  }

  return { tag: "UnknownNotarizeError", message: "unknown notarize error" }
}

const formatNotarizeErrorText = (error: NotarizePipelineError): string => {
  const formatted = formatNotarizeError(error)
  return formatted.remediation === undefined
    ? `${formatted.tag}: ${formatted.message}`
    : `${formatted.tag}: ${formatted.message}\nNext: ${formatted.remediation}`
}

const formatProductionCheckError = (error: BuildConfigError | Error): string =>
  JSON.stringify(
    error instanceof BuildConfigError
      ? {
          tag: error._tag,
          message: error.message,
          field: error.field
        }
      : {
          tag: error.name,
          message: error.message
        },
    null,
    2
  )

const formatPublishReport = (report: DesktopPublishReport): string =>
  [
    "Effect Desktop publish",
    `app               ${report.appId}`,
    `version           ${report.version}`,
    `channel           ${report.channel}`,
    `keyVersion        ${report.keyVersion}`,
    `manifest          ${report.manifestPath}`,
    ...report.artifacts.map(
      (artifact) =>
        `${artifact.platform.padEnd(17)} ${artifact.kind.padEnd(8)} ${artifact.sizeBytes
          .toString()
          .padStart(4)}b ${artifact.url}`
    ),
    ""
  ].join("\n")

const formatPublishError = (
  error: PublishPipelineError
): { readonly tag: string; readonly message: string; readonly remediation?: string } => {
  if (error instanceof PublishConfigError) {
    return { tag: error._tag, message: error.message, remediation: error.remediation }
  }
  if (error instanceof PublishFileError) {
    return { tag: error._tag, message: error.message }
  }
  if (error instanceof PublishSignatureError) {
    return { tag: error._tag, message: error.message }
  }
  return { tag: "UnknownPublishError", message: "unknown publish error" }
}

const formatPublishErrorText = (error: PublishPipelineError): string => {
  const formatted = formatPublishError(error)
  return formatted.remediation === undefined
    ? `${formatted.tag}: ${formatted.message}`
    : `${formatted.tag}: ${formatted.message}\nNext: ${formatted.remediation}`
}

const loadConfig = (path: string): Effect.Effect<unknown, BuildConfigError, never> =>
  Effect.gen(function* () {
    const module = yield* Effect.tryPromise({
      try: async () => (await import(pathToFileUrl(path))) as { readonly default?: unknown },
      catch: (cause) =>
        new BuildConfigError({
          field: "default",
          message: `failed to load config ${path}: ${formatUnknownError(cause)}`
        })
    })
    if (!isRecord(module.default)) {
      return yield* Effect.fail(
        new BuildConfigError({
          field: "default",
          message: `config ${path} must export a default object`
        })
      )
    }
    return module.default
  })

const loadRendererFiles = (
  cwd: string,
  rendererPath: string | undefined
): Effect.Effect<readonly ProductionCheckFile[], Error, never> =>
  Effect.gen(function* () {
    if (rendererPath === undefined) {
      return []
    }
    const absolutePath = resolvePath(cwd, rendererPath)
    const content = yield* Effect.tryPromise({
      try: () => Bun.file(absolutePath).text(),
      catch: (cause) =>
        cause instanceof Error
          ? cause
          : new CliUsageError(`failed to read renderer ${rendererPath}`)
    })
    return [{ path: rendererPath, content }]
  })

const copyDirectory = (
  source: string,
  destination: string
): Effect.Effect<void, BuildFileError, never> =>
  Effect.gen(function* () {
    yield* makeDirectory(destination)
    const entries = yield* readDirectory(source)
    for (const entry of entries) {
      const sourcePath = join(source, entry)
      const destinationPath = join(destination, entry)
      const entryStat = yield* statPath(sourcePath)
      if (entryStat.isDirectory()) {
        yield* copyDirectory(sourcePath, destinationPath)
      } else {
        yield* copyFileEffect(sourcePath, destinationPath)
      }
    }
  })

const writeJson = (path: string, value: unknown): Effect.Effect<void, BuildFileError, never> =>
  Effect.gen(function* () {
    yield* makeDirectory(dirname(path))
    yield* Effect.tryPromise({
      try: () => writeFile(path, `${JSON.stringify(value, null, 2)}\n`),
      catch: (cause) =>
        new BuildFileError({
          operation: "write",
          path,
          message: `failed to write ${path}`,
          cause
        })
    })
  })

const makeDirectory = (path: string): Effect.Effect<void, BuildFileError, never> =>
  Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }),
    catch: (cause) =>
      new BuildFileError({
        operation: "mkdir",
        path,
        message: `failed to create ${path}`,
        cause
      })
  }).pipe(Effect.asVoid)

const removePath = (path: string): Effect.Effect<void, BuildFileError, never> =>
  Effect.tryPromise({
    try: () => rm(path, { recursive: true, force: true }),
    catch: (cause) =>
      new BuildFileError({
        operation: "rm",
        path,
        message: `failed to remove ${path}`,
        cause
      })
  })

const readDirectory = (path: string): Effect.Effect<readonly string[], BuildFileError, never> =>
  Effect.tryPromise({
    try: () => readdir(path),
    catch: (cause) =>
      new BuildFileError({
        operation: "readdir",
        path,
        message: `failed to read ${path}`,
        cause
      })
  })

const statPath = (
  path: string
): Effect.Effect<Awaited<ReturnType<typeof stat>>, BuildFileError, never> =>
  Effect.tryPromise({
    try: () => stat(path),
    catch: (cause) =>
      new BuildFileError({
        operation: "stat",
        path,
        message: `failed to stat ${path}`,
        cause
      })
  })

const copyFileEffect = (
  source: string,
  destination: string
): Effect.Effect<void, BuildFileError, never> =>
  Effect.gen(function* () {
    yield* makeDirectory(dirname(destination))
    yield* Effect.tryPromise({
      try: () => copyFile(source, destination),
      catch: (cause) =>
        new BuildFileError({
          operation: "copy",
          path: source,
          message: `failed to copy ${source} to ${destination}`,
          cause
        })
    })
  })

const resolvePath = (cwd: string, path: string): string =>
  isAbsolute(path) ? path : resolve(cwd, path)

const hostBuildOutputPath = (repoRoot: string, target: BuildTarget): string =>
  join(repoRoot, "target", "release", hostBinaryName(target))

const hostBinaryName = (target: BuildTarget): string =>
  target.startsWith("windows-") ? "host.exe" : "host"

const pathToFileUrl = (path: string): string => pathToFileURL(path).href

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null

const formatUnknownError = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

type CheckFlags = {
  readonly production: boolean
  readonly repro: boolean
  readonly api: boolean
  readonly docs: boolean
  readonly release: boolean
  readonly a11y: boolean
  readonly semver: boolean
  readonly config: Option.Option<string>
  readonly renderer: Option.Option<string>
  readonly platform: Option.Option<string>
  readonly artifact: Option.Option<string>
  readonly write: boolean
  readonly json: boolean
}

const runProductionCheckHandler = (
  flags: CheckFlags,
  options: CliRunOptions,
  fail: (code: number) => Effect.Effect<void, never, never>
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const configPath = Option.getOrElse(flags.config, () => "desktop.config.ts")
    const absoluteConfigPath = resolvePath(options.cwd, configPath)
    const config = yield* loadConfig(absoluteConfigPath).pipe(
      Effect.map((value) => value as ProductionSecurityConfig),
      Effect.catch((error) =>
        Effect.sync(() => {
          const output = flags.json
            ? `${formatProductionCheckError(error)}\n`
            : `${error.name}: ${error.message}\n`
          options.writeStderr(output)
          return undefined
        })
      )
    )
    if (config === undefined) {
      yield* fail(1)
      return
    }

    const rendererFiles = yield* loadRendererFiles(
      options.cwd,
      Option.getOrUndefined(flags.renderer)
    ).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const output = flags.json
            ? `${formatProductionCheckError(error)}\n`
            : `${error.name}: ${error.message}\n`
          options.writeStderr(output)
          return undefined
        })
      )
    )
    if (rendererFiles === undefined) {
      yield* fail(1)
      return
    }

    const report = yield* runProductionCheck({
      config,
      configPath,
      rendererFiles
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          options.writeStderr(`${error._tag}: ${error.message}\n`)
          return undefined
        })
      )
    )
    if (report === undefined) {
      yield* fail(1)
      return
    }

    if (flags.json) {
      const formatted = `${JSON.stringify(report, null, 2)}\n`
      if (report.passed) {
        options.writeStdout(formatted)
      } else {
        options.writeStderr(formatted)
        yield* fail(1)
      }
      return
    }

    const formatted = formatProductionCheckReport(report)
    if (report.passed) {
      options.writeStdout(formatted)
    } else {
      options.writeStderr(formatted)
      yield* fail(1)
    }
  })

const runReproCheckHandler = (
  flags: CheckFlags,
  options: CliRunOptions,
  fail: (code: number) => Effect.Effect<void, never, never>
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const configPath = Option.getOrElse(flags.config, () => "desktop.config.ts")
    const artifact = Option.getOrElse(flags.artifact, () => "all")
    const report = yield* runDesktopReproCheck({
      buildRunner: ({ now }) =>
        runDesktopBuild({
          cwd: options.cwd,
          configPath,
          platform: Option.getOrUndefined(flags.platform),
          commandRunner: options.commandRunner ?? runCommand,
          now,
          hostTarget: options.hostTarget
        }),
      packageRunner: ({ now }) =>
        runDesktopPackage({
          cwd: options.cwd,
          configPath,
          platform: Option.getOrUndefined(flags.platform),
          artifact,
          commandRunner: options.packageCommandRunner ?? runPackageCommand,
          now,
          hostTarget: options.hostTarget
        })
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const formatted = formatReproError(error)
          if (flags.json) {
            options.writeStderr(`${JSON.stringify(formatted, null, 2)}\n`)
          } else if (formatted.report === undefined) {
            options.writeStderr(`${formatted.tag}: ${formatted.message}\n`)
          } else {
            options.writeStderr(formatReproReport(formatted.report))
          }
          return undefined
        })
      )
    )
    if (report === undefined) {
      yield* fail(1)
      return
    }
    if (flags.json) {
      options.writeStdout(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      options.writeStdout(formatReproReport(report))
    }
  })

const runApiCheckHandler = (
  flags: CheckFlags,
  options: CliRunOptions,
  fail: (code: number) => Effect.Effect<void, never, never>
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const report = yield* runPublicApiCheck({
      cwd: options.cwd,
      updateSnapshots: flags.write
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const formatted = formatPublicApiError(error)
          if (flags.json) {
            options.writeStderr(`${JSON.stringify(formatted, null, 2)}\n`)
          } else if (formatted.report === undefined) {
            options.writeStderr(`${formatted.tag}: ${formatted.message}\n`)
          } else {
            options.writeStderr(formatPublicApiReport(formatted.report))
          }
          return undefined
        })
      )
    )
    if (report === undefined) {
      yield* fail(1)
      return
    }
    if (flags.json) {
      options.writeStdout(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      options.writeStdout(formatPublicApiReport(report))
    }
  })

const runDocsCheckHandler = (
  flags: CheckFlags,
  options: CliRunOptions,
  fail: (code: number) => Effect.Effect<void, never, never>
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const report = yield* runDocsReleaseGate({ cwd: options.cwd }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const formatted = formatDocsReleaseGateError(error)
          if (flags.json) {
            options.writeStderr(`${JSON.stringify(formatted, null, 2)}\n`)
          } else {
            options.writeStderr(`${formatted.tag}: ${formatted.message}\n`)
          }
          return undefined
        })
      )
    )
    if (report === undefined) {
      yield* fail(1)
      return
    }
    if (flags.json) {
      options.writeStdout(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      options.writeStdout(formatDocsReleaseGateReport(report))
    }
  })

const runReleaseCheckHandler = (
  flags: CheckFlags,
  options: CliRunOptions,
  fail: (code: number) => Effect.Effect<void, never, never>
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const report = yield* runReleaseGate({ cwd: options.cwd }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const formatted = formatReleaseGateError(error)
          if (flags.json) {
            options.writeStderr(`${JSON.stringify(formatted, null, 2)}\n`)
          } else {
            options.writeStderr(`${formatted.tag}: ${formatted.message}\n`)
          }
          return undefined
        })
      )
    )
    if (report === undefined) {
      yield* fail(1)
      return
    }
    if (flags.json) {
      options.writeStdout(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      options.writeStdout(formatReleaseGateReport(report))
    }
  })

const runA11yCheckHandler = (
  flags: CheckFlags,
  options: CliRunOptions,
  fail: (code: number) => Effect.Effect<void, never, never>
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const report = yield* runAccessibilityGate({ cwd: options.cwd }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const formatted = formatAccessibilityGateError(error)
          if (flags.json) {
            options.writeStderr(`${JSON.stringify(formatted, null, 2)}\n`)
          } else {
            options.writeStderr(`${formatted.tag}: ${formatted.message}\n`)
          }
          return undefined
        })
      )
    )
    if (report === undefined) {
      yield* fail(1)
      return
    }
    if (flags.json) {
      options.writeStdout(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      options.writeStdout(formatAccessibilityGateReport(report))
    }
  })

const runSemverCheckHandler = (
  flags: CheckFlags,
  options: CliRunOptions,
  fail: (code: number) => Effect.Effect<void, never, never>
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const report = yield* runSemverGuard({ cwd: options.cwd }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const formatted = formatSemverGuardError(error)
          if (flags.json) {
            options.writeStderr(`${JSON.stringify(formatted, null, 2)}\n`)
          } else if (formatted.report === undefined) {
            options.writeStderr(`${formatted.tag}: ${formatted.message}\n`)
          } else {
            options.writeStderr(formatSemverGuardReport(formatted.report))
          }
          return undefined
        })
      )
    )
    if (report === undefined) {
      yield* fail(1)
      return
    }
    if (flags.json) {
      options.writeStdout(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      options.writeStdout(formatSemverGuardReport(report))
    }
  })

type CliEnvironment =
  | FileSystem.FileSystem
  | Path.Path
  | Terminal.Terminal
  | ChildProcessSpawnerModule.ChildProcessSpawner.ChildProcessSpawner
  | Stdio.Stdio

const makeCliLayer = (options: CliRunOptions): Layer.Layer<CliEnvironment, never, never> => {
  const fileSystemLayer = FileSystem.layerNoop({})

  const pathLayer = Path.layer

  const terminalLayer = Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(80),
      readInput: Effect.die("readInput not supported in non-interactive CLI"),
      readLine: Effect.die("readLine not supported in non-interactive CLI"),
      display: (text) =>
        Effect.sync(() => {
          options.writeStdout(text)
        })
    })
  )

  const stdioLayer = Stdio.layerTest({
    args: Effect.succeed([]),
    stdout: () =>
      Sink.forEach((chunk: string | Uint8Array) =>
        Effect.sync(() => {
          options.writeStdout(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
        })
      ),
    stderr: () =>
      Sink.forEach((chunk: string | Uint8Array) =>
        Effect.sync(() => {
          options.writeStderr(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
        })
      )
  })

  const childProcessSpawnerLayer = Layer.succeed(
    ChildProcessSpawnerModule.ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawnerModule.ChildProcessSpawner.make(() =>
      Effect.die("spawn not supported in non-interactive CLI")
    )
  )

  const format = (args: ReadonlyArray<unknown>): string =>
    args.map((a) => (typeof a === "string" ? a : String(a))).join(" ")

  const consoleLayer = Layer.succeed(Console.Console, {
    assert: (condition, ...args) => {
      if (!condition) options.writeStderr(`Assertion failed: ${format(args)}\n`)
    },
    clear: () => {},
    count: () => {},
    countReset: () => {},
    debug: (...args) => {
      options.writeStdout(`${format(args)}\n`)
    },
    dir: (item) => {
      options.writeStdout(`${String(item)}\n`)
    },
    dirxml: (...args) => {
      options.writeStdout(`${format(args)}\n`)
    },
    error: (...args) => {
      options.writeStderr(`${format(args)}\n`)
    },
    group: (...args) => {
      if (args.length > 0) options.writeStdout(`${format(args)}\n`)
    },
    groupCollapsed: (...args) => {
      if (args.length > 0) options.writeStdout(`${format(args)}\n`)
    },
    groupEnd: () => {},
    info: (...args) => {
      options.writeStdout(`${format(args)}\n`)
    },
    log: (...args) => {
      options.writeStdout(`${format(args)}\n`)
    },
    table: (tabularData) => {
      options.writeStdout(`${String(tabularData)}\n`)
    },
    time: () => {},
    timeEnd: () => {},
    timeLog: () => {},
    trace: (...args) => {
      options.writeStderr(`${format(args)}\n`)
    },
    warn: (...args) => {
      options.writeStderr(`${format(args)}\n`)
    }
  })

  return Layer.mergeAll(
    fileSystemLayer,
    pathLayer,
    terminalLayer,
    stdioLayer,
    childProcessSpawnerLayer,
    consoleLayer
  )
}
