import { copyFile, lstat, mkdir, readlink, readdir, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path"
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
  PackageMissingBuildArtifactError,
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
  type DocsGateCoverageError,
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
  type SemverPackageVersion,
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
  readonly stdout?: string
  readonly stderr?: string
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
const DEFAULT_RUNTIME_ENGINE = "bun"
const DEFAULT_RENDERER_FRAMEWORK = "react"
const DEFAULT_RENDERER_STYLING = "tailwind"
const DEFAULT_PROFILE = "dev"
const RESERVED_PROTOCOL_SCHEMES = new Set([
  "http",
  "https",
  "file",
  "about",
  "data",
  "chrome",
  "view-source"
])
const DEFAULT_PROTOCOL_FRAME_BYTES = 4 * 1024 * 1024
const MAX_PROTOCOL_FRAME_BYTES = 16 * 1024 * 1024
const DEFAULT_PROTOCOL_CONCURRENT_REQUESTS_PER_WINDOW = 256
const MAX_PROTOCOL_CONCURRENT_REQUESTS_PER_WINDOW = 4096
const DEFAULT_PROTOCOL_CONCURRENT_STREAMS_PER_WINDOW = 64
const MAX_PROTOCOL_CONCURRENT_STREAMS_PER_WINDOW = 1024
const DEFAULT_PROTOCOL_QUEUED_EVENTS_PER_SUBSCRIPTION = 1024
const MAX_PROTOCOL_QUEUED_EVENTS_PER_SUBSCRIPTION = 65_536
const PROTOCOL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/u
type BuildExternalNavigationPolicy = "deny" | "ask"
const WINDOW_TITLE_BAR_STYLES = new Set([
  "default",
  "hidden",
  "hiddenInset",
  "customButtonsOnHover"
])
const CSS_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/u
const ROOT_HELP = [
  "Usage: desktop <command> [options]",
  "",
  "Commands:",
  "  init",
  "  dev",
  "  build",
  "  package",
  "  sign",
  "  notarize",
  "  publish",
  "  typecheck",
  "  lint",
  "  test",
  "  doctor",
  "  info",
  "  generate-types",
  "  migrate",
  "  clean",
  "  inspect",
  "  replay",
  "  check",
  ""
].join("\n")
const DEFERRED_COMMANDS = [
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
const JSON_VALUE_FLAGS = new Set([
  "--artifact",
  "--config",
  "--out",
  "--platform",
  "--profile",
  "--renderer",
  "--target"
])

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
  readonly profile: string
  readonly commandRunner: CommandRunner
  readonly now: () => number
  readonly hostTarget: BuildTarget | undefined
}

interface BuildPlan {
  readonly appId: string
  readonly appName: string
  readonly appVersion: string
  readonly profile: string
  readonly buildTargets: readonly BuildTarget[]
  readonly appRoot: string
  readonly configPath: string
  readonly runtimeEngine: "bun"
  readonly runtimeEntry: string
  readonly rendererFramework: "react"
  readonly rendererStyling: "tailwind"
  readonly rendererEntry: string
  readonly rendererDistPath: string
  readonly runtimeEntryPath: string
  readonly rendererEntryPath: string
  readonly layoutPath: string
  readonly targetEnv: Record<string, string>
  readonly runtimeProtocolLimits:
    | {
        readonly maxFrameBytes: number
        readonly maxConcurrentRequestsPerWindow: number
        readonly maxConcurrentStreamsPerWindow: number
        readonly maxQueuedEventsPerSubscription: number | undefined
      }
    | undefined
  readonly security: {
    readonly externalNavigation: BuildExternalNavigationPolicy
    readonly devtoolsInProd: boolean
  }
  readonly protocols: readonly { readonly scheme: string; readonly handler: string | undefined }[]
  readonly windows: unknown
  readonly updateManifestInput:
    | {
        readonly channel?: "stable" | "beta" | "canary"
        readonly publicKey?: string
        readonly feedUrl?: string
        readonly minVersion?: string
        readonly maxVersion?: string
        readonly keyVersion?: number
        readonly rollback?: boolean
      }
    | undefined
  readonly target: BuildTarget
}

interface AppConfig {
  readonly app?: {
    readonly id?: unknown
    readonly name?: unknown
    readonly version?: unknown
  }
  readonly runtime?: {
    readonly engine?: unknown
    readonly entry?: unknown
  }
  readonly renderer?: {
    readonly framework?: unknown
    readonly styling?: unknown
    readonly entry?: unknown
    readonly dist?: unknown
  }
  readonly build?: {
    readonly targets?: unknown
  }
  readonly security?: {
    readonly externalNavigation?: unknown
    readonly devtoolsInProd?: unknown
  }
  readonly env?: unknown
  readonly protocol?: {
    readonly limits?: unknown
  }
  readonly protocols?: unknown
  readonly native?: {
    readonly host?: unknown
    readonly renderer?: unknown
  }
  readonly workspace?: {
    readonly sharedConfigPath?: unknown
  }
  readonly update?: {
    readonly channel?: unknown
    readonly publicKey?: unknown
    readonly feedUrl?: unknown
    readonly minVersion?: unknown
    readonly maxVersion?: unknown
    readonly keyVersion?: unknown
    readonly rollback?: unknown
  }
  readonly windows?: unknown
}

export const runCli = (options: CliRunOptions): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    if (isRootHelp(options.argv)) {
      options.writeStdout(ROOT_HELP)
      return 0
    }

    const usageError = findJsonValueFlagUsageError(options.argv)
    if (usageError !== undefined) {
      options.writeStderr(`${JSON.stringify(formatCliUsageError(usageError), null, 2)}\n`)
      return 1
    }

    const exitCodeRef = yield* Ref.make(0)

    const fail = (code: number): Effect.Effect<void, never, never> => Ref.set(exitCodeRef, code)

    const buildCmd = Command.make(
      "build",
      {
        config: Flag.string("config").pipe(Flag.withDefault("desktop.config.ts")),
        platform: Flag.optional(Flag.string("platform")),
        profile: Flag.string("profile").pipe(Flag.withDefault(DEFAULT_PROFILE)),
        json: Flag.boolean("json").pipe(Flag.withDefault(false))
      },
      (flags) =>
        Effect.gen(function* () {
          const report = yield* runDesktopBuild({
            cwd: options.cwd,
            configPath: flags.config,
            platform: Option.getOrUndefined(flags.platform),
            profile: flags.profile,
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

    const deferredCommands = DEFERRED_COMMANDS.map((name) =>
      Command.make(
        name,
        {
          json: Flag.boolean("json").pipe(Flag.withDefault(false))
        },
        (flags) =>
          Effect.gen(function* () {
            const error = deferredCommandError(name)
            if (flags.json) {
              options.writeStderr(`${JSON.stringify(error, null, 2)}\n`)
            } else {
              options.writeStderr(`${error.tag}: ${error.message}\nNext: ${error.remediation}\n`)
            }
            yield* fail(1)
          })
      ).pipe(Command.withDescription(`Deferred desktop ${name} command.`))
    )

    const desktopCmd = Command.make("desktop").pipe(
      Command.withSubcommands([
        ...deferredCommands,
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

const isRootHelp = (argv: readonly string[]): boolean =>
  argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")

const findJsonValueFlagUsageError = (argv: readonly string[]): CliUsageError | undefined => {
  if (!argv.includes("--json")) {
    return undefined
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined || !JSON_VALUE_FLAGS.has(arg)) {
      continue
    }

    const value = argv[index + 1]
    if (value === undefined || value.startsWith("--")) {
      return new CliUsageError(`${arg} requires a value`)
    }
  }

  return undefined
}

const formatCliUsageError = (
  error: CliUsageError
): { readonly tag: "CliUsageError"; readonly message: string } => ({
  tag: "CliUsageError",
  message: error.message
})

const deferredCommandError = (
  command: (typeof DEFERRED_COMMANDS)[number]
): {
  readonly tag: "CliDeferredCommand"
  readonly command: string
  readonly message: string
  readonly remediation: string
} => ({
  tag: "CliDeferredCommand",
  command,
  message: `desktop ${command} is declared but not implemented in this milestone`,
  remediation: "Use the implemented build/package/sign/notarize/publish/doctor/check commands."
})

export const runDesktopBuild = (
  options: DesktopBuildOptions
): Effect.Effect<DesktopBuildReport, BuildPipelineError, never> =>
  Effect.gen(function* () {
    const absoluteConfigPath = resolvePath(options.cwd, options.configPath)
    const config = yield* loadAndMergeBuildConfig(absoluteConfigPath)
    const hostTarget = yield* resolveHostTarget(options.hostTarget)
    const target = yield* resolveBuildTarget(options.platform, hostTarget)
    const plan = yield* normalizeBuildPlan(config, {
      profile: options.profile,
      configPath: absoluteConfigPath,
      hostTarget,
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
  config: AppConfig,
  options: {
    readonly configPath: string
    readonly hostTarget: BuildTarget
    readonly target: BuildTarget
    readonly profile: string
  }
): Effect.Effect<BuildPlan, BuildConfigError | BuildUnsupportedTargetError, never> =>
  Effect.gen(function* () {
    const appRoot = dirname(options.configPath)
    const appId = yield* readSafeAppId(config.app?.id, "app.id")
    const appName = yield* readRequiredString(config.app?.name, "app.name")
    const appVersion = yield* readSemverString(config.app?.version, "app.version")
    const runtimeEngine = yield* readRuntimeEngine(config.runtime?.engine)
    const rendererFramework = yield* readRendererFramework(config.renderer?.framework)
    const rendererStyling = yield* readRendererStyling(config.renderer?.styling)
    const rendererEntry = yield* readRequiredExistingFile(
      config.renderer?.entry,
      "renderer.entry",
      appRoot
    )
    const rendererEntryPath = resolvePath(appRoot, rendererEntry)
    const runtimeEntry = yield* readRequiredExistingFile(
      config.runtime?.entry,
      "runtime.entry",
      appRoot
    )
    const runtimeEntryPath = resolvePath(appRoot, runtimeEntry)
    const runtimeEntryName = basename(runtimeEntry)
    const runtimeEntryExt = extname(runtimeEntryName)
    const runtimeEntryOutputName =
      runtimeEntryExt === ".ts" || runtimeEntryExt === ".tsx"
        ? `${runtimeEntryName.slice(0, -runtimeEntryExt.length)}.js`
        : runtimeEntryName
    const rendererDist =
      (yield* readOptionalString(config.renderer?.dist, "renderer.dist")) ?? "dist"
    const rendererDistPath = yield* readContainedAppPath(appRoot, rendererDist, "renderer.dist")
    const profile = yield* readRequiredString(options.profile, "profile")
    const profileEnv = yield* readProfileEnv(config.env, profile)
    const protocolEntries = yield* readProtocols(config.protocols)
    const protocolLimits = yield* readProtocolLimits(config.protocol?.limits)
    const security = yield* readBuildSecurity(config.security)
    const windows = yield* readWindowsConfig(config.windows)
    const buildTargets = yield* readBuildTargets(
      config.build?.targets,
      options.target,
      "build.targets"
    )
    if (!buildTargets.includes(options.target)) {
      return yield* Effect.fail(
        new BuildConfigError({
          field: "build.targets",
          message: `build.targets does not include target ${options.target}`
        })
      )
    }
    const updateManifestInput = yield* readUpdateFields(config.update, appVersion)

    return {
      appId,
      appName,
      appVersion,
      profile,
      rendererFramework,
      rendererStyling,
      rendererEntry,
      appRoot,
      configPath: options.configPath,
      runtimeEngine,
      runtimeEntry: `runtime/${runtimeEntryOutputName}`,
      rendererDistPath,
      runtimeEntryPath,
      rendererEntryPath,
      targetEnv: profileEnv,
      runtimeProtocolLimits: protocolLimits,
      security,
      protocols: protocolEntries,
      windows,
      buildTargets,
      updateManifestInput,
      layoutPath: resolvePath(appRoot, join("build", "effect-desktop", options.target)),
      target: options.target
    }
  })

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
        stdout: "pipe",
        stderr: "pipe"
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        readBoundedStreamText(process.stdout),
        readBoundedStreamText(process.stderr),
        process.exited
      ])
      if (exitCode !== 0) {
        throw new BuildCommandFailedError({
          step: invocation.step,
          command: [invocation.command, ...invocation.args],
          cwd: invocation.cwd,
          exitCode,
          message: `${invocation.step} command exited with ${exitCode}`,
          ...(stdout.length === 0 ? {} : { stdout }),
          ...(stderr.length === 0 ? {} : { stderr })
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
    const protocolSchemes = plan.protocols.map((protocol) => protocol.scheme)
    yield* writeJson(path, {
      id: plan.appId,
      name: plan.appName,
      version: plan.appVersion,
      target: plan.target,
      appManifest: {
        id: plan.appId,
        name: plan.appName,
        version: plan.appVersion,
        profile: plan.profile,
        dataDirs: ["data"],
        protocolSchemes
      },
      hostManifest: {
        nativeHost: "rust-wry-tao",
        systemWebView: "system-webview",
        windows: plan.windows,
        protocols: protocolSchemes,
        signingHints: {}
      },
      runtimeManifest: {
        engine: plan.runtimeEngine,
        entry: plan.runtimeEntry,
        env: plan.targetEnv,
        permissions: {},
        telemetry: { enabled: true },
        protocolLimits: plan.runtimeProtocolLimits
      },
      rendererManifest: {
        framework: plan.rendererFramework,
        entry: plan.rendererEntry,
        assetBaseUrl: "app://localhost/",
        csp: {},
        navigationPolicy: plan.security.externalNavigation,
        devtoolsInProd: plan.security.devtoolsInProd
      },
      renderer: {
        assetBaseUrl: "app://localhost/",
        path: "renderer"
      },
      runtime: {
        engine: plan.runtimeEngine,
        entry: plan.runtimeEntry
      },
      nativeHost: {
        binary: `native/${hostBinaryName(plan.target)}`
      },
      bridge: {
        manifest: "bridge/bridge-manifest.json"
      },
      permissionManifest: {
        normalizedCapabilities: {},
        approvalDefaults: {},
        redactionPolicy: {
          defaultPatternEnabled: true,
          additionalPatterns: [],
          allowlist: []
        }
      },
      packageManifest: {
        targets: plan.buildTargets,
        artifactLayout: join("dist", "desktop"),
        bundleId: plan.appId,
        resources: [],
        signing: {}
      },
      updateManifestInput: plan.updateManifestInput
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
    return { tag: error._tag, message: formatBuildCommandErrorMessage(error) }
  }
  if (error instanceof BuildFileError) {
    return { tag: error._tag, message: error.message }
  }
  if (error instanceof BuildConfigError) {
    return { tag: error._tag, message: error.message }
  }

  return { tag: "UnknownBuildError", message: "unknown build error" }
}

const formatBuildCommandErrorMessage = (error: BuildCommandFailedError): string => {
  const output = [error.stderr, error.stdout].filter(
    (text): text is string => text !== undefined && text.length > 0
  )
  return output.length === 0 ? error.message : `${error.message}\n${output.join("\n")}`
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
  if (error instanceof PackageMissingBuildArtifactError) {
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
      parseSemver(version) !== undefined
        ? Effect.succeed(version)
        : Effect.fail(
            new BuildConfigError({ field, message: `${field} must be a SemVer X.Y.Z string` })
          )
    )
  )

const validateProductionConfigBaseline = (
  config: AppConfig
): Effect.Effect<void, BuildConfigError, never> =>
  Effect.gen(function* () {
    yield* readSafeAppId(config.app?.id, "app.id")
    yield* readRequiredString(config.app?.name, "app.name")
    yield* readSemverString(config.app?.version, "app.version")
  })

const parseSemver = (value: string): Semver | undefined => {
  const match = SEMVER_PATTERN.exec(value)
  if (match === undefined || match === null) {
    return undefined
  }
  const [, major, minor, patch] = match
  if (major === undefined || minor === undefined || patch === undefined) {
    return undefined
  }
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10)
  }
}

type Semver = {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

type SemverField = {
  readonly value: string
  readonly parsed: Semver
}

const compareSemver = (left: Semver, right: Semver): number => {
  if (left.major !== right.major) {
    return left.major - right.major
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor
  }
  return left.patch - right.patch
}

const readOptionalSemver = (
  value: unknown,
  field: string
): Effect.Effect<SemverField | undefined, BuildConfigError, never> => {
  if (value === undefined) {
    return Effect.succeed(undefined)
  }
  return readRequiredString(value, field).pipe(
    Effect.flatMap((version) => {
      const parsed = parseSemver(version)
      return parsed === undefined
        ? Effect.fail(
            new BuildConfigError({
              field,
              message: `${field} must be a SemVer X.Y.Z string`
            })
          )
        : Effect.succeed({
            value: version,
            parsed
          })
    })
  )
}

const loadAndMergeBuildConfig = (path: string): Effect.Effect<AppConfig, BuildConfigError, never> =>
  Effect.gen(function* () {
    const rawConfig = yield* loadConfig(path).pipe(Effect.map((value) => value as AppConfig))
    const appConfig = normalizeBuildConfig(rawConfig)
    const sharedConfigPath = yield* readOptionalString(
      appConfig.workspace?.sharedConfigPath,
      "workspace.sharedConfigPath"
    )
    if (sharedConfigPath === undefined) {
      return appConfig
    }
    const workspaceRoot = dirname(path)
    const rawSharedConfig = yield* loadConfig(resolvePath(workspaceRoot, sharedConfigPath)).pipe(
      Effect.map((value) => value as AppConfig)
    )
    const sharedConfig = normalizeBuildConfig(rawSharedConfig)
    return mergeBuildConfig(sharedConfig, appConfig)
  })

const normalizeBuildConfig = (rawConfig: unknown): AppConfig =>
  isRecord(rawConfig) ? (rawConfig as AppConfig) : {}

const mergeBuildConfig = (shared: AppConfig, app: AppConfig): AppConfig => {
  const env = mergeRecordMap(shared.env, app.env)
  const protocols =
    Array.isArray(app.protocols) && app.protocols.length > 0
      ? app.protocols
      : Array.isArray(shared.protocols)
        ? shared.protocols
        : undefined
  const workspace = app.workspace ?? shared.workspace
  const windows = app.windows ?? shared.windows

  return {
    app: {
      ...shared.app,
      ...app.app
    },
    runtime: {
      ...shared.runtime,
      ...app.runtime
    },
    renderer: {
      ...shared.renderer,
      ...app.renderer
    },
    build: {
      ...shared.build,
      ...app.build
    },
    security: {
      ...shared.security,
      ...app.security
    },
    ...(env === undefined ? {} : { env }),
    protocol: {
      limits: {
        ...extractRecord(shared.protocol?.limits),
        ...extractRecord(app.protocol?.limits)
      }
    },
    ...(protocols === undefined ? {} : { protocols }),
    native: {
      ...shared.native,
      ...app.native
    },
    ...(workspace === undefined ? {} : { workspace }),
    update: {
      ...shared.update,
      ...app.update
    },
    ...(windows === undefined ? {} : { windows })
  }
}

const mergeRecordMap = (shared: unknown, local: unknown): Record<string, unknown> | undefined => {
  if (shared === undefined && local === undefined) {
    return undefined
  }
  const merged: Record<string, unknown> = {}
  if (isRecord(shared)) {
    for (const key of Object.keys(shared)) {
      const value = shared[key]
      if (isRecord(value)) {
        merged[key] = mergeRecordMap(merged[key], value)
      } else {
        merged[key] = value
      }
    }
  }
  if (isRecord(local)) {
    for (const key of Object.keys(local)) {
      const value = local[key]
      const existing = merged[key]
      if (isRecord(existing) && isRecord(value)) {
        merged[key] = mergeRecordMap(existing, value)
      } else {
        merged[key] = value
      }
    }
  }
  return merged
}

const extractRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})

const readRuntimeEngine = (value: unknown): Effect.Effect<"bun", BuildConfigError, never> =>
  readOptionalString(value, "runtime.engine").pipe(
    Effect.map((rawEngine) => rawEngine ?? DEFAULT_RUNTIME_ENGINE),
    Effect.flatMap((runtimeEngine) =>
      runtimeEngine === DEFAULT_RUNTIME_ENGINE
        ? Effect.succeed(runtimeEngine)
        : Effect.fail(
            new BuildConfigError({
              field: "runtime.engine",
              message: `runtime.engine must be ${DEFAULT_RUNTIME_ENGINE}`
            })
          )
    )
  )

const readRendererFramework = (value: unknown): Effect.Effect<"react", BuildConfigError, never> =>
  readOptionalString(value, "renderer.framework").pipe(
    Effect.map((rawFramework) => rawFramework ?? DEFAULT_RENDERER_FRAMEWORK),
    Effect.flatMap((rendererFramework) =>
      rendererFramework === DEFAULT_RENDERER_FRAMEWORK
        ? Effect.succeed(rendererFramework)
        : Effect.fail(
            new BuildConfigError({
              field: "renderer.framework",
              message: `renderer.framework must be ${DEFAULT_RENDERER_FRAMEWORK}`
            })
          )
    )
  )

const readRendererStyling = (value: unknown): Effect.Effect<"tailwind", BuildConfigError, never> =>
  readOptionalString(value, "renderer.styling").pipe(
    Effect.map((rawStyling) => rawStyling ?? DEFAULT_RENDERER_STYLING),
    Effect.flatMap((rendererStyling) =>
      rendererStyling === DEFAULT_RENDERER_STYLING
        ? Effect.succeed(rendererStyling)
        : Effect.fail(
            new BuildConfigError({
              field: "renderer.styling",
              message: `renderer.styling must be ${DEFAULT_RENDERER_STYLING}`
            })
          )
    )
  )

const readRequiredExistingFile = (
  value: unknown,
  field: string,
  root: string
): Effect.Effect<string, BuildConfigError, never> =>
  readRequiredString(value, field).pipe(
    Effect.flatMap((path) =>
      readContainedAppPath(root, path, field).pipe(
        Effect.flatMap((containedPath) => statPath(containedPath)),
        Effect.flatMap((stats) =>
          stats.isDirectory()
            ? Effect.fail(
                new BuildConfigError({
                  field,
                  message: `${field} must be an existing file, not a directory`
                })
              )
            : Effect.succeed(path)
        ),
        Effect.catch(() =>
          Effect.fail(new BuildConfigError({ field, message: `${field} must exist at ${path}` }))
        )
      )
    )
  )

const readContainedAppPath = (
  root: string,
  path: string,
  field: string
): Effect.Effect<string, BuildConfigError, never> => {
  if (isAbsolute(path)) {
    return Effect.fail(
      new BuildConfigError({ field, message: `${field} must be relative to the app root` })
    )
  }

  const resolvedPath = resolve(root, path)
  const relativePath = relative(root, resolvedPath)
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return Effect.succeed(resolvedPath)
  }

  return Effect.fail(
    new BuildConfigError({ field, message: `${field} must stay inside the app root` })
  )
}

const readProtocols = (
  value: unknown
): Effect.Effect<
  readonly { readonly scheme: string; readonly handler: string | undefined }[],
  BuildConfigError,
  never
> =>
  Effect.gen(function* () {
    if (value === undefined) {
      return []
    }
    if (!Array.isArray(value)) {
      return yield* Effect.fail(
        new BuildConfigError({ field: "protocols", message: "protocols must be an array" })
      )
    }
    const entries: { scheme: string; handler: string | undefined }[] = []
    for (let index = 0; index < value.length; index += 1) {
      const field = `protocols[${index}]`
      const protocol = value[index]
      if (!isRecord(protocol)) {
        return yield* Effect.fail(
          new BuildConfigError({ field, message: `${field} must be an object` })
        )
      }
      const scheme = yield* readRequiredString(protocol["scheme"], `${field}.scheme`)
      if (!PROTOCOL_SCHEME_PATTERN.test(scheme) || RESERVED_PROTOCOL_SCHEMES.has(scheme)) {
        return yield* Effect.fail(
          new BuildConfigError({
            field: `${field}.scheme`,
            message: `${field}.scheme must be a lowercase ASCII scheme not in ${[...RESERVED_PROTOCOL_SCHEMES].join(", ")}`
          })
        )
      }
      const handler = yield* readOptionalString(protocol["handler"], `${field}.handler`)
      if (handler !== undefined && handler !== "open" && handler !== "view") {
        return yield* Effect.fail(
          new BuildConfigError({
            field: `${field}.handler`,
            message: `${field}.handler must be "open" or "view"`
          })
        )
      }
      entries.push({ scheme, handler })
    }
    return entries
  })

type BuildProtocolLimits = {
  readonly maxFrameBytes: number
  readonly maxConcurrentRequestsPerWindow: number
  readonly maxConcurrentStreamsPerWindow: number
  readonly maxQueuedEventsPerSubscription: number | undefined
}

const readProtocolLimits = (
  value: unknown
): Effect.Effect<BuildProtocolLimits, BuildConfigError, never> => {
  const limits = isRecord(value) ? value : {}
  return readProtocolLimit(
    limits,
    "protocol.limits.maxFrameBytes",
    MAX_PROTOCOL_FRAME_BYTES,
    false,
    DEFAULT_PROTOCOL_FRAME_BYTES
  ).pipe(
    Effect.flatMap((maxFrameBytes) =>
      readProtocolLimit(
        limits,
        "protocol.limits.maxConcurrentRequestsPerWindow",
        MAX_PROTOCOL_CONCURRENT_REQUESTS_PER_WINDOW,
        false,
        DEFAULT_PROTOCOL_CONCURRENT_REQUESTS_PER_WINDOW
      ).pipe(
        Effect.flatMap((maxConcurrentRequestsPerWindow) =>
          readProtocolLimit(
            limits,
            "protocol.limits.maxConcurrentStreamsPerWindow",
            MAX_PROTOCOL_CONCURRENT_STREAMS_PER_WINDOW,
            false,
            DEFAULT_PROTOCOL_CONCURRENT_STREAMS_PER_WINDOW
          ).pipe(
            Effect.flatMap((maxConcurrentStreamsPerWindow) =>
              readProtocolLimit(
                limits,
                "protocol.limits.maxQueuedEventsPerSubscription",
                MAX_PROTOCOL_QUEUED_EVENTS_PER_SUBSCRIPTION,
                false,
                DEFAULT_PROTOCOL_QUEUED_EVENTS_PER_SUBSCRIPTION
              ).pipe(
                Effect.map((maxQueuedEventsPerSubscription) => ({
                  maxFrameBytes,
                  maxConcurrentRequestsPerWindow,
                  maxConcurrentStreamsPerWindow,
                  maxQueuedEventsPerSubscription
                }))
              )
            )
          )
        )
      )
    )
  )
}

const readProtocolLimit = (
  value: Record<string, unknown>,
  field: string,
  cap: number,
  required = false,
  defaultValue = cap
): Effect.Effect<number, BuildConfigError, never> => {
  const key = field.substring(field.lastIndexOf(".") + 1)
  const raw = value[key]
  if (raw === undefined) {
    return required
      ? Effect.fail(new BuildConfigError({ field, message: `${field} is required` }))
      : Effect.succeed(defaultValue)
  }
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw <= 0) {
    return Effect.fail(
      new BuildConfigError({ field, message: `${field} must be a positive integer` })
    )
  }
  if (raw > cap) {
    return Effect.fail(
      new BuildConfigError({
        field,
        message: `${field} cannot exceed ${cap}`
      })
    )
  }
  return Effect.succeed(raw)
}

const readBuildSecurity = (
  value: AppConfig["security"]
): Effect.Effect<
  { readonly externalNavigation: BuildExternalNavigationPolicy; readonly devtoolsInProd: boolean },
  BuildConfigError,
  never
> =>
  Effect.gen(function* () {
    const externalNavigation = yield* readExternalNavigation(value?.externalNavigation)
    const devtoolsInProd = yield* readOptionalBoolean(
      value?.devtoolsInProd,
      "security.devtoolsInProd",
      false
    )
    return { externalNavigation, devtoolsInProd }
  })

const readExternalNavigation = (
  value: unknown
): Effect.Effect<BuildExternalNavigationPolicy, BuildConfigError, never> => {
  if (value === undefined) {
    return Effect.succeed("deny")
  }
  if (value === "deny" || value === "ask") {
    return Effect.succeed(value)
  }
  return Effect.fail(
    new BuildConfigError({
      field: "security.externalNavigation",
      message: 'security.externalNavigation must be "deny" or "ask"'
    })
  )
}

const readOptionalBoolean = (
  value: unknown,
  field: string,
  defaultValue: boolean
): Effect.Effect<boolean, BuildConfigError, never> => {
  if (value === undefined) {
    return Effect.succeed(defaultValue)
  }
  return typeof value === "boolean"
    ? Effect.succeed(value)
    : Effect.fail(new BuildConfigError({ field, message: `${field} must be a boolean` }))
}

const readBuildTargets = (
  value: unknown,
  defaultTarget: BuildTarget,
  field: string
): Effect.Effect<readonly BuildTarget[], BuildConfigError, never> => {
  if (value === undefined) {
    return Effect.succeed([defaultTarget])
  }
  if (!Array.isArray(value)) {
    return Effect.fail(
      new BuildConfigError({ field, message: `${field} must be an array of build targets` })
    )
  }
  const targets: BuildTarget[] = []
  for (const raw of value) {
    if (typeof raw !== "string") {
      return Effect.fail(
        new BuildConfigError({ field, message: `${field} must be an array of build targets` })
      )
    }
    if (!isBuildTarget(raw)) {
      return Effect.fail(
        new BuildConfigError({
          field,
          message: `${field} must include only known targets, not ${raw}`
        })
      )
    }
    if (!targets.includes(raw)) {
      targets.push(raw)
    }
  }
  return Effect.succeed(targets)
}

const readWindowsConfig = (value: unknown): Effect.Effect<unknown, BuildConfigError, never> => {
  if (value === undefined) {
    return Effect.succeed(undefined)
  }
  if (!isRecord(value)) {
    return Effect.fail(
      new BuildConfigError({ field: "windows", message: "windows must be an object" })
    )
  }

  const defaults = value["defaults"]
  if (defaults !== undefined) {
    const validatedDefaults = validateWindowOptions(defaults, "windows.defaults")
    if (validatedDefaults !== undefined) {
      return Effect.fail(validatedDefaults)
    }
  }

  for (const key of Object.keys(value)) {
    if (key === "defaults") {
      continue
    }
    const field = `windows.${key}`
    const declaration = value[key]
    if (!isRecord(declaration)) {
      return Effect.fail(new BuildConfigError({ field, message: `${field} must be an object` }))
    }
    const validationError = validateWindowOptions(declaration, field)
    if (validationError !== undefined) {
      return Effect.fail(validationError)
    }
  }

  return Effect.succeed(value)
}

const validateWindowOptions = (value: unknown, field: string): BuildConfigError | undefined => {
  if (!isRecord(value)) {
    return new BuildConfigError({ field, message: `${field} must be an object` })
  }

  const titleBarStyle = value["titleBarStyle"]
  if (titleBarStyle !== undefined && !WINDOW_TITLE_BAR_STYLES.has(String(titleBarStyle))) {
    return new BuildConfigError({
      field: `${field}.titleBarStyle`,
      message: `${field}.titleBarStyle must be default, hidden, hiddenInset, or customButtonsOnHover`
    })
  }

  const trafficLights = value["trafficLights"]
  if (trafficLights !== undefined) {
    const trafficLightsError = validateTrafficLights(trafficLights, `${field}.trafficLights`)
    if (trafficLightsError !== undefined) {
      return trafficLightsError
    }
  }

  const hasShadow = value["hasShadow"]
  if (hasShadow !== undefined && typeof hasShadow !== "boolean") {
    return new BuildConfigError({
      field: `${field}.hasShadow`,
      message: `${field}.hasShadow must be a boolean`
    })
  }

  const backgroundColor = value["backgroundColor"]
  if (
    backgroundColor !== undefined &&
    (typeof backgroundColor !== "string" || !CSS_HEX_COLOR_PATTERN.test(backgroundColor))
  ) {
    return new BuildConfigError({
      field: `${field}.backgroundColor`,
      message: `${field}.backgroundColor must be a #RRGGBB or #RRGGBBAA color`
    })
  }

  const widthError = validatePositiveNumber(value["width"], `${field}.width`)
  if (widthError !== undefined) {
    return widthError
  }
  const heightError = validatePositiveNumber(value["height"], `${field}.height`)
  if (heightError !== undefined) {
    return heightError
  }

  return undefined
}

const validateTrafficLights = (value: unknown, field: string): BuildConfigError | undefined => {
  if (!isRecord(value)) {
    return new BuildConfigError({ field, message: `${field} must be an object` })
  }

  return (
    validateNonNegativeNumber(value["x"], `${field}.x`) ??
    validateNonNegativeNumber(value["y"], `${field}.y`)
  )
}

const validatePositiveNumber = (value: unknown, field: string): BuildConfigError | undefined => {
  if (value === undefined) {
    return undefined
  }
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? undefined
    : new BuildConfigError({ field, message: `${field} must be a positive finite number` })
}

const validateNonNegativeNumber = (value: unknown, field: string): BuildConfigError | undefined => {
  if (value === undefined) {
    return undefined
  }
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? undefined
    : new BuildConfigError({ field, message: `${field} must be a non-negative finite number` })
}

const readProfileEnv = (
  value: unknown,
  profile: string
): Effect.Effect<Record<string, string>, BuildConfigError, never> => {
  if (value === undefined) {
    return Effect.succeed({})
  }
  if (!isRecord(value)) {
    return Effect.fail(new BuildConfigError({ field: "env", message: "env must be an object" }))
  }
  const profileEnv = value[profile]
  if (profileEnv === undefined) {
    return Effect.succeed({})
  }
  if (!isRecord(profileEnv)) {
    return Effect.fail(
      new BuildConfigError({
        field: `env.${profile}`,
        message: `env.${profile} must be an object`
      })
    )
  }
  const result: Record<string, string> = {}
  for (const key of Object.keys(profileEnv)) {
    const entry = profileEnv[key]
    if (typeof entry !== "string") {
      return Effect.fail(
        new BuildConfigError({
          field: `env.${profile}.${key}`,
          message: `env.${profile}.${key} must be a string`
        })
      )
    }
    result[key] = entry
  }
  return Effect.succeed(result)
}

const readUpdateFields = (
  value: unknown,
  appVersion: string
): Effect.Effect<
  | {
      readonly channel?: "stable" | "beta" | "canary"
      readonly publicKey?: string
      readonly feedUrl?: string
      readonly minVersion?: string
      readonly maxVersion?: string
      readonly keyVersion?: number
      readonly rollback?: boolean
    }
  | undefined,
  BuildConfigError,
  never
> =>
  Effect.gen(function* () {
    if (value === undefined) {
      return undefined
    }
    if (!isRecord(value)) {
      return yield* Effect.fail(
        new BuildConfigError({ field: "update", message: "update must be an object" })
      )
    }
    const channel = yield* readOptionalUpdateChannel(value["channel"])
    if (channel === undefined) {
      return undefined
    }
    const publicKey = yield* readRequiredString(value["publicKey"], "update.publicKey")
    const feedUrl = yield* readRequiredString(value["feedUrl"], "update.feedUrl")
    const minVersion = yield* readOptionalSemver(value["minVersion"], "update.minVersion")
    const maxVersion = yield* readOptionalSemver(value["maxVersion"], "update.maxVersion")
    const keyVersion =
      value["keyVersion"] === undefined || typeof value["keyVersion"] === "number"
        ? value["keyVersion"]
        : yield* Effect.fail(
            new BuildConfigError({
              field: "update.keyVersion",
              message: "update.keyVersion must be an integer"
            })
          )
    const rollback =
      value["rollback"] === undefined || typeof value["rollback"] === "boolean"
        ? value["rollback"]
        : yield* Effect.fail(
            new BuildConfigError({
              field: "update.rollback",
              message: "update.rollback must be a boolean"
            })
          )
    const parsedAppVersion = parseSemver(appVersion)
    if (parsedAppVersion === undefined) {
      return yield* Effect.fail(
        new BuildConfigError({
          field: "app.version",
          message: "app.version must be a SemVer X.Y.Z string"
        })
      )
    }
    if (minVersion !== undefined && compareSemver(minVersion.parsed, parsedAppVersion) > 0) {
      return yield* Effect.fail(
        new BuildConfigError({
          field: "update.minVersion",
          message: `update.minVersion ${minVersion.value} must not exceed app.version ${appVersion}`
        })
      )
    }
    if (
      maxVersion !== undefined &&
      minVersion !== undefined &&
      compareSemver(minVersion.parsed, maxVersion.parsed) > 0
    ) {
      return yield* Effect.fail(
        new BuildConfigError({
          field: "update.maxVersion",
          message: `update.maxVersion ${maxVersion.value} must not be lower than update.minVersion ${minVersion.value}`
        })
      )
    }
    if (rollback === true && maxVersion === undefined) {
      return yield* Effect.fail(
        new BuildConfigError({
          field: "update.maxVersion",
          message: "update.maxVersion is required when rollback is true"
        })
      )
    }
    return {
      channel,
      publicKey,
      feedUrl,
      ...(minVersion === undefined ? {} : { minVersion: minVersion.value }),
      ...(maxVersion === undefined ? {} : { maxVersion: maxVersion.value }),
      ...(keyVersion === undefined ? {} : { keyVersion }),
      ...(rollback === undefined ? {} : { rollback })
    }
  })

const readOptionalUpdateChannel = (
  value: unknown
): Effect.Effect<"stable" | "beta" | "canary" | undefined, BuildConfigError, never> =>
  value === undefined
    ? Effect.succeed(undefined)
    : value === "stable" || value === "beta" || value === "canary"
      ? Effect.succeed(value)
      : Effect.fail(
          new BuildConfigError({
            field: "update.channel",
            message: "update.channel must be stable, beta, or canary"
          })
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
): Effect.Effect<void, BuildFileError, never> => copyContainedDirectory(source, destination, source)

const copyContainedDirectory = (
  root: string,
  destination: string,
  source: string
): Effect.Effect<void, BuildFileError, never> =>
  Effect.gen(function* () {
    yield* makeDirectory(destination)
    const entries = yield* readDirectory(source)
    for (const entry of entries) {
      const sourcePath = join(source, entry)
      const destinationPath = join(destination, entry)
      const entryStat = yield* lstatPath(sourcePath)
      const copySourcePath = entryStat.isSymbolicLink()
        ? yield* resolveContainedSymlink(root, sourcePath)
        : sourcePath
      const copySourceStat = entryStat.isSymbolicLink()
        ? yield* statPath(copySourcePath)
        : entryStat
      if (copySourceStat.isDirectory()) {
        yield* copyContainedDirectory(root, destinationPath, copySourcePath)
      } else {
        yield* copyFileEffect(copySourcePath, destinationPath)
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

const lstatPath = (
  path: string
): Effect.Effect<Awaited<ReturnType<typeof lstat>>, BuildFileError, never> =>
  Effect.tryPromise({
    try: () => lstat(path),
    catch: (cause) =>
      new BuildFileError({
        operation: "lstat",
        path,
        message: `failed to lstat ${path}`,
        cause
      })
  })

const readlinkPath = (path: string): Effect.Effect<string, BuildFileError, never> =>
  Effect.tryPromise({
    try: () => readlink(path),
    catch: (cause) =>
      new BuildFileError({
        operation: "readlink",
        path,
        message: `failed to readlink ${path}`,
        cause
      })
  })

const resolveContainedSymlink = (
  root: string,
  symlinkPath: string
): Effect.Effect<string, BuildFileError, never> =>
  Effect.gen(function* () {
    const target = yield* readlinkPath(symlinkPath)
    const resolvedTarget = resolve(dirname(symlinkPath), target)
    if (isPathInside(root, resolvedTarget)) {
      return resolvedTarget
    }
    return yield* Effect.fail(
      new BuildFileError({
        operation: "copy",
        path: symlinkPath,
        message: `symlink ${symlinkPath} points outside ${root}`,
        cause: target
      })
    )
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

const isPathInside = (root: string, path: string): boolean => {
  const relativePath = relative(root, path)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

const hostBuildOutputPath = (repoRoot: string, target: BuildTarget): string =>
  join(repoRoot, "target", "release", hostBinaryName(target))

const hostBinaryName = (target: BuildTarget): string =>
  target.startsWith("windows-") ? "host.exe" : "host"

const pathToFileUrl = (path: string): string => pathToFileURL(path).href

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null

const MAX_COMMAND_OUTPUT_CHARS = 16_384

const readBoundedStreamText = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let result = ""
  let truncated = false

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }
      if (result.length < MAX_COMMAND_OUTPUT_CHARS) {
        result += decoder.decode(chunk.value, { stream: true })
        if (result.length > MAX_COMMAND_OUTPUT_CHARS) {
          result = result.slice(0, MAX_COMMAND_OUTPUT_CHARS)
          truncated = true
        }
      } else {
        truncated = true
      }
    }
    result += decoder.decode()
  } finally {
    reader.releaseLock()
  }

  return truncated ? `${result}\n[output truncated]` : result
}

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
      Effect.map((value) => value as AppConfig & ProductionSecurityConfig),
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

    const baselinePassed = yield* validateProductionConfigBaseline(config).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        Effect.sync(() => {
          const output = flags.json
            ? `${formatProductionCheckError(error)}\n`
            : `${error.name}: ${error.message}\n`
          options.writeStderr(output)
          return false
        })
      )
    )
    if (!baselinePassed) {
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
          profile: DEFAULT_PROFILE,
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
