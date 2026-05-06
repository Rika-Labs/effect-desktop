import { mkdir, readdir, rm, stat, writeFile, copyFile } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { HOST_PROTOCOL_VERSION } from "@effect-desktop/bridge"
import { Data, Effect } from "effect"

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
  type DoctorCommandRunner,
  type DesktopDoctorReport
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
    if (options.argv[0] === "build") {
      return yield* runBuildCli(options)
    }

    if (options.argv[0] === "package") {
      return yield* runPackageCli(options)
    }

    if (options.argv[0] === "doctor") {
      return yield* runDoctorCli(options)
    }

    if (options.argv[0] === "sign") {
      return yield* runSignCli(options)
    }

    if (options.argv[0] === "check" && options.argv.includes("--repro")) {
      return yield* runReproCheckCli(options)
    }

    if (options.argv[0] !== "check" || !options.argv.includes("--production")) {
      options.writeStderr(
        "Usage: desktop build --config <path>\nUsage: desktop package --config <path>\nUsage: desktop sign --config <path>\nUsage: desktop doctor [--config <path>] [--ci] [--json]\nUsage: desktop check --production --config <path>\nUsage: desktop check --repro --config <path>\n"
      )
      return 1
    }

    return yield* runProductionCheckCli(options)
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
      args: ["build", "-p", "host"],
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

const runProductionCheckCli = (options: CliRunOptions): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    const configPath = yield* readOptionalPathArg(options.argv, "--config", options.writeStderr)
    if (configPath === undefined && options.argv.includes("--config")) {
      return 1
    }

    const rendererPath = yield* readOptionalPathArg(options.argv, "--renderer", options.writeStderr)
    if (rendererPath === undefined && options.argv.includes("--renderer")) {
      return 1
    }

    const selectedConfigPath = configPath ?? "desktop.config.ts"
    const absoluteConfigPath = resolvePath(options.cwd, selectedConfigPath)
    const config = yield* loadConfig(absoluteConfigPath).pipe(
      Effect.map((value) => value as ProductionSecurityConfig),
      Effect.catch((error) =>
        Effect.sync(() => {
          options.writeStderr(`${error.name}: ${error.message}\n`)
          return undefined
        })
      )
    )
    if (config === undefined) {
      return 1
    }

    const rendererFiles = yield* loadRendererFiles(options.cwd, rendererPath).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          options.writeStderr(`${error.name}: ${error.message}\n`)
          return undefined
        })
      )
    )
    if (rendererFiles === undefined) {
      return 1
    }

    const report = yield* runProductionCheck({
      config,
      configPath: selectedConfigPath,
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
      return 1
    }

    const formatted = formatProductionCheckReport(report)
    if (report.passed) {
      options.writeStdout(formatted)
      return 0
    }

    options.writeStderr(formatted)
    return 1
  })

const runBuildCli = (options: CliRunOptions): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    if (options.argv.includes("--help")) {
      options.writeStdout(BUILD_HELP)
      return 0
    }

    const configPath = yield* readOptionalPathArg(options.argv, "--config", options.writeStderr)
    if (configPath === undefined && options.argv.includes("--config")) {
      return 1
    }
    const platform = yield* readOptionalPathArg(options.argv, "--platform", options.writeStderr)
    if (platform === undefined && options.argv.includes("--platform")) {
      return 1
    }

    const report = yield* runDesktopBuild({
      cwd: options.cwd,
      configPath: configPath ?? "desktop.config.ts",
      platform,
      commandRunner: options.commandRunner ?? runCommand,
      now: options.now ?? Date.now,
      hostTarget: options.hostTarget
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          if (options.argv.includes("--json")) {
            options.writeStderr(`${JSON.stringify(formatBuildError(error), null, 2)}\n`)
          } else {
            options.writeStderr(`${formatBuildErrorText(error)}\n`)
          }
          return undefined
        })
      )
    )

    if (report === undefined) {
      return 1
    }

    if (options.argv.includes("--json")) {
      options.writeStdout(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      options.writeStdout(formatBuildReport(report))
    }

    return 0
  })

const runPackageCli = (options: CliRunOptions): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    if (options.argv.includes("--help")) {
      options.writeStdout(PACKAGE_HELP)
      return 0
    }

    const configPath = yield* readOptionalPathArg(options.argv, "--config", options.writeStderr)
    if (configPath === undefined && options.argv.includes("--config")) {
      return 1
    }
    const platform = yield* readOptionalPathArg(options.argv, "--platform", options.writeStderr)
    if (platform === undefined && options.argv.includes("--platform")) {
      return 1
    }
    const artifact = yield* readOptionalPathArg(options.argv, "--artifact", options.writeStderr)
    if (artifact === undefined && options.argv.includes("--artifact")) {
      return 1
    }

    const report = yield* runDesktopPackage({
      cwd: options.cwd,
      configPath: configPath ?? "desktop.config.ts",
      platform,
      artifact,
      commandRunner: options.packageCommandRunner ?? runPackageCommand,
      now: options.now ?? Date.now,
      hostTarget: options.hostTarget
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          if (options.argv.includes("--json")) {
            options.writeStderr(`${JSON.stringify(formatPackageError(error), null, 2)}\n`)
          } else {
            options.writeStderr(`${formatPackageErrorText(error)}\n`)
          }
          return undefined
        })
      )
    )

    if (report === undefined) {
      return 1
    }

    if (options.argv.includes("--json")) {
      options.writeStdout(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      options.writeStdout(formatPackageReport(report))
    }

    return 0
  })

const runSignCli = (options: CliRunOptions): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    if (options.argv.includes("--help")) {
      options.writeStdout(SIGN_HELP)
      return 0
    }

    const configPath = yield* readOptionalPathArg(options.argv, "--config", options.writeStderr)
    if (configPath === undefined && options.argv.includes("--config")) {
      return 1
    }
    const platform = yield* readOptionalPathArg(options.argv, "--platform", options.writeStderr)
    if (platform === undefined && options.argv.includes("--platform")) {
      return 1
    }

    const report = yield* runDesktopSign({
      cwd: options.cwd,
      configPath: configPath ?? "desktop.config.ts",
      platform,
      commandRunner: options.signCommandRunner ?? runSignCommand,
      now: options.now ?? Date.now,
      hostTarget: options.hostTarget
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          if (options.argv.includes("--json")) {
            options.writeStderr(`${JSON.stringify(formatSignError(error), null, 2)}\n`)
          } else {
            options.writeStderr(`${formatSignErrorText(error)}\n`)
          }
          return undefined
        })
      )
    )

    if (report === undefined) {
      return 1
    }

    if (options.argv.includes("--json")) {
      options.writeStdout(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      options.writeStdout(formatSignReport(report))
    }

    return 0
  })

const runDoctorCli = (options: CliRunOptions): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    if (options.argv.includes("--help")) {
      options.writeStdout(DOCTOR_HELP)
      return 0
    }

    const configPath = yield* readOptionalPathArg(options.argv, "--config", options.writeStderr)
    if (configPath === undefined && options.argv.includes("--config")) {
      return 1
    }

    const report = yield* runDesktopDoctor({
      cwd: options.cwd,
      configPath,
      ci: options.argv.includes("--ci"),
      platform: options.platform ?? process.platform,
      arch: options.arch ?? process.arch,
      bunVersion: options.bunVersion ?? Bun.version,
      commandRunner: options.doctorCommandRunner ?? runDoctorCommand
    })

    if (options.argv.includes("--json")) {
      const output: DesktopDoctorReport = report
      if (report.passed) {
        options.writeStdout(`${JSON.stringify(output, null, 2)}\n`)
      } else {
        options.writeStderr(`${JSON.stringify(output, null, 2)}\n`)
      }
    } else if (report.passed) {
      options.writeStdout(formatDoctorReport(report))
    } else {
      options.writeStderr(formatDoctorReport(report))
    }

    return report.passed ? 0 : 1
  })

const runReproCheckCli = (options: CliRunOptions): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    const configPath = yield* readOptionalPathArg(options.argv, "--config", options.writeStderr)
    if (configPath === undefined && options.argv.includes("--config")) {
      return 1
    }
    const platform = yield* readOptionalPathArg(options.argv, "--platform", options.writeStderr)
    if (platform === undefined && options.argv.includes("--platform")) {
      return 1
    }
    const artifact = yield* readOptionalPathArg(options.argv, "--artifact", options.writeStderr)
    if (artifact === undefined && options.argv.includes("--artifact")) {
      return 1
    }

    const selectedConfigPath = configPath ?? "desktop.config.ts"
    const selectedArtifact = artifact ?? "all"
    const report = yield* runDesktopReproCheck({
      buildRunner: ({ now }) =>
        runDesktopBuild({
          cwd: options.cwd,
          configPath: selectedConfigPath,
          platform,
          commandRunner: options.commandRunner ?? runCommand,
          now,
          hostTarget: options.hostTarget
        }),
      packageRunner: ({ now }) =>
        runDesktopPackage({
          cwd: options.cwd,
          configPath: selectedConfigPath,
          platform,
          artifact: selectedArtifact,
          commandRunner: options.packageCommandRunner ?? runPackageCommand,
          now,
          hostTarget: options.hostTarget
        })
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const formatted = formatReproError(error)
          if (options.argv.includes("--json")) {
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
      return 1
    }

    if (options.argv.includes("--json")) {
      options.writeStdout(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      options.writeStdout(formatReproReport(report))
    }

    return 0
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
    const appId = yield* readRequiredString(config.app?.id, "app.id")
    const appName = yield* readRequiredString(config.app?.name, "app.name")
    const appVersion = yield* readRequiredString(config.app?.version, "app.version")
    const rendererDist =
      (yield* readOptionalString(config.renderer?.dist, "renderer.dist")) ?? "dist"
    const configuredRuntimeEntry = yield* readOptionalString(config.runtime?.entry, "runtime.entry")
    const runtimeEntryPath =
      configuredRuntimeEntry === undefined
        ? resolvePath(options.workspaceRoot, "packages/core/src/runtime/main.ts")
        : resolvePath(appRoot, configuredRuntimeEntry)

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
        entry: "runtime/main.js"
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

const BUILD_HELP = [
  "Usage: desktop build --config <path> [--platform <target>] [--json]",
  "",
  "Builds renderer, runtime, native host, bridge manifest, and app manifest into build/effect-desktop/<target>.",
  ""
].join("\n")

const PACKAGE_HELP = [
  "Usage: desktop package --config <path> [--platform <target>] [--artifact <kind>] [--json]",
  "",
  "Packages an existing build/effect-desktop/<target> layout into the fixed docs/SPEC.md §23.2 artifact set.",
  "Kinds: all, app, dmg, zip, msi, appimage, deb, rpm.",
  ""
].join("\n")

const SIGN_HELP = [
  "Usage: desktop sign --config <path> [--platform <target>] [--json]",
  "",
  "Signs existing dist/desktop/<platform> artifacts with platform signing tools and writes sign-report.json.",
  ""
].join("\n")

const DOCTOR_HELP = [
  "Usage: desktop doctor [--config <path>] [--ci] [--json]",
  "",
  "Validates Bun, Rust, platform SDK, WebView runtime, signing credentials, build tools, package manager state, native host cache, and desktop config before build/package.",
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
  if (error instanceof PackageFileError) {
    return { tag: error._tag, message: error.message }
  }
  if (error instanceof PackageConfigError) {
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

const readOptionalPathArg = (
  argv: readonly string[],
  name: "--config" | "--renderer" | "--platform" | "--artifact",
  writeStderr: (text: string) => void
): Effect.Effect<string | undefined, never, never> =>
  optionalPathArg(argv, name).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        writeStderr(`${error.name}: ${error.message}\n`)
        return undefined
      })
    )
  )

const optionalPathArg = (
  argv: readonly string[],
  name: "--config" | "--renderer" | "--platform" | "--artifact"
): Effect.Effect<string | undefined, CliUsageError, never> =>
  Effect.sync(() => {
    const index = argv.indexOf(name)
    if (index === -1) {
      return undefined
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith("--")) {
      return new CliUsageError(`${name} requires a path`)
    }
    return value
  }).pipe(
    Effect.flatMap((value) =>
      value instanceof CliUsageError ? Effect.fail(value) : Effect.succeed(value)
    )
  )

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
  join(repoRoot, "target", "debug", hostBinaryName(target))

const hostBinaryName = (target: BuildTarget): string =>
  target.startsWith("windows-") ? "host.exe" : "host"

const pathToFileUrl = (path: string): string => pathToFileURL(path).href

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null

const formatUnknownError = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)
