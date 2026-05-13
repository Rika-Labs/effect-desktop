import { createHash } from "node:crypto"
import { lstat, mkdir, readdir, readFile, readlink, stat, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { Data, Effect } from "effect"

import {
  decodeDesktopTarget,
  detectDesktopHostTarget,
  isMacosDesktopTargetId,
  resolveMacosDesktopHostTarget
} from "./targets.js"
import type {
  DesktopTarget,
  MacosDesktopTargetId,
  UnsupportedDesktopHostTargetError
} from "./targets.js"

export type NotarizeTarget = MacosDesktopTargetId
export type NotarizeArtifactKind = "app" | "dmg"
export type NotarizeStepName =
  | "stapler-validate"
  | "notarytool-submit"
  | "stapler-staple"
  | "spctl-assess"
  | "metadata"

export class NotarizeConfigError extends Data.TaggedError("NotarizeConfigError")<{
  readonly field: string
  readonly message: string
  readonly remediation: string
}> {}

export class NotarizeUnsupportedHostError extends Data.TaggedError("NotarizeUnsupportedHostError")<{
  readonly platform: string
  readonly arch: string
  readonly message: string
  readonly remediation: string
}> {}

export class NotarizeUnsupportedTargetError extends Data.TaggedError(
  "NotarizeUnsupportedTargetError"
)<{
  readonly target: string
  readonly hostTarget: NotarizeTarget
  readonly message: string
  readonly remediation: string
}> {}

export class NotarizeFileError extends Data.TaggedError("NotarizeFileError")<{
  readonly operation: string
  readonly path: string
  readonly message: string
  readonly cause: unknown
}> {}

export class NotarizeCommandFailedError extends Data.TaggedError("NotarizeCommandFailedError")<{
  readonly step: NotarizeStepName
  readonly command: readonly string[]
  readonly cwd: string
  readonly exitCode: number | undefined
  readonly message: string
  readonly stdout?: string
  readonly stderr?: string
}> {}

export type NotarizePipelineError =
  | NotarizeConfigError
  | NotarizeUnsupportedHostError
  | NotarizeUnsupportedTargetError
  | NotarizeFileError
  | NotarizeCommandFailedError

export interface NotarizeCommandInvocation {
  readonly step: NotarizeStepName
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}

export interface NotarizeCommandOutput {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export type NotarizeCommandRunner = (
  invocation: NotarizeCommandInvocation
) => Effect.Effect<NotarizeCommandOutput, NotarizeCommandFailedError, never>

export interface DesktopNotarizeOptions {
  readonly cwd: string
  readonly configPath: string
  readonly platform: string | undefined
  readonly commandRunner: NotarizeCommandRunner
  readonly now: () => number
  readonly hostTarget: NotarizeTarget | undefined
}

export interface NotarizeStepReport {
  readonly name: NotarizeStepName
  readonly command?: readonly string[]
  readonly cwd?: string
  readonly elapsedMs: number
  readonly outputPath: string
  readonly stdout?: string
  readonly stderr?: string
}

export interface NotarizeArtifactReport {
  readonly kind: NotarizeArtifactKind
  readonly artifactPath: string
  readonly alreadyStapled: boolean
  readonly submissionId?: string
  readonly status?: string
  readonly assessed: boolean
}

export interface DesktopNotarizeReport {
  readonly appId: string
  readonly appName: string
  readonly appVersion: string
  readonly target: NotarizeTarget
  readonly outputPath: string
  readonly artifacts: readonly NotarizeArtifactReport[]
  readonly steps: readonly NotarizeStepReport[]
}

interface AppConfig {
  readonly app?: {
    readonly id?: unknown
    readonly name?: unknown
    readonly version?: unknown
  }
  readonly signing?: {
    readonly macos?: {
      readonly teamId?: unknown
      readonly notarytoolProfile?: unknown
      readonly appleId?: unknown
      readonly passwordEnv?: unknown
    }
  }
}

interface NotarizePlan {
  readonly appId: string
  readonly appName: string
  readonly appVersion: string
  readonly appRoot: string
  readonly outputPath: string
  readonly target: NotarizeTarget
  readonly config: AppConfig
}

interface PackagedArtifact {
  readonly appId: string
  readonly appName: string
  readonly appVersion: string
  readonly kind: NotarizeArtifactKind
  readonly rootPath: string
  readonly artifactPath: string
}

interface NotaryCredentials {
  readonly args: readonly string[]
  readonly reportArgs: readonly string[]
}

export const runDesktopNotarize = (
  options: DesktopNotarizeOptions
): Effect.Effect<DesktopNotarizeReport, NotarizePipelineError, never> =>
  Effect.gen(function* () {
    const absoluteConfigPath = resolvePath(options.cwd, options.configPath)
    const rawConfig = yield* loadConfig(absoluteConfigPath)
    const hostTarget = yield* resolveHostTarget(options.hostTarget)
    const target = yield* resolveNotarizeTarget(options.platform, hostTarget)
    const plan = yield* normalizeNotarizePlan(rawConfig, {
      configPath: absoluteConfigPath,
      target
    })
    const artifacts = yield* readPackagedArtifacts(plan)
    const credentials = yield* resolveCredentials(plan.config)
    const steps: NotarizeStepReport[] = []
    const reports: NotarizeArtifactReport[] = []

    for (const artifact of artifacts) {
      const notarized = yield* notarizeArtifact(options, plan, artifact, credentials)
      steps.push(...notarized.steps)
      reports.push(notarized.artifact)
    }

    const reportPath = join(plan.outputPath, "notarize-report.json")
    steps.push({ name: "metadata", elapsedMs: 0, outputPath: reportPath })
    const report: DesktopNotarizeReport = {
      appId: plan.appId,
      appName: plan.appName,
      appVersion: plan.appVersion,
      target: plan.target,
      outputPath: plan.outputPath,
      artifacts: reports,
      steps
    }
    yield* writeJson(reportPath, report)
    return report
  })

export const detectNotarizeHostTarget = (): NotarizeTarget | undefined => {
  const target = detectDesktopHostTarget()
  return isMacosDesktopTargetId(target) ? target : undefined
}

export const runNotarizeCommand: NotarizeCommandRunner = (invocation) =>
  Effect.tryPromise({
    try: async () => {
      const spawned = Bun.spawn([invocation.command, ...invocation.args], {
        cwd: invocation.cwd,
        stdout: "pipe",
        stderr: "pipe"
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        readStreamText(spawned.stdout),
        readStreamText(spawned.stderr),
        spawned.exited
      ])
      return { stdout, stderr, exitCode }
    },
    catch: (cause) =>
      new NotarizeCommandFailedError({
        step: invocation.step,
        command: [invocation.command, ...invocation.args],
        cwd: invocation.cwd,
        exitCode: undefined,
        message: formatUnknownError(cause)
      })
  })

const notarizeArtifact = (
  options: DesktopNotarizeOptions,
  plan: NotarizePlan,
  artifact: PackagedArtifact,
  credentials: NotaryCredentials
): Effect.Effect<
  { readonly artifact: NotarizeArtifactReport; readonly steps: readonly NotarizeStepReport[] },
  NotarizePipelineError,
  never
> =>
  Effect.gen(function* () {
    const steps: NotarizeStepReport[] = []
    const validate = yield* runToolStep(
      options,
      "stapler-validate",
      "xcrun",
      ["stapler", "validate", artifact.artifactPath],
      plan.outputPath,
      artifact.artifactPath,
      true
    )
    steps.push(validate.step)
    const alreadyStapled = validate.output.exitCode === 0
    let submission: NotarySubmission | undefined

    if (!alreadyStapled) {
      const submitArgs = [
        "notarytool",
        "submit",
        artifact.artifactPath,
        "--wait",
        "--output-format",
        "json",
        ...credentials.args
      ]
      const submitReportArgs = [
        "notarytool",
        "submit",
        artifact.artifactPath,
        "--wait",
        "--output-format",
        "json",
        ...credentials.reportArgs
      ]
      const submit = yield* runToolStep(
        options,
        "notarytool-submit",
        "xcrun",
        submitArgs,
        plan.outputPath,
        artifact.artifactPath,
        false,
        submitReportArgs
      )
      steps.push(submit.step)
      submission = yield* parseSubmission(submit.output.stdout, submit.output.stderr)
      if (submission.status !== "Accepted") {
        return yield* Effect.fail(
          new NotarizeCommandFailedError({
            step: "notarytool-submit",
            command: ["xcrun", ...submitReportArgs],
            cwd: plan.outputPath,
            exitCode: submit.output.exitCode,
            message: `notarytool returned ${submission.status}`,
            stdout: submit.output.stdout,
            stderr: submit.output.stderr
          })
        )
      }
      const staple = yield* runToolStep(
        options,
        "stapler-staple",
        "xcrun",
        ["stapler", "staple", artifact.artifactPath],
        plan.outputPath,
        artifact.artifactPath
      )
      steps.push(staple.step)
    }

    const assess = yield* runToolStep(
      options,
      "spctl-assess",
      "spctl",
      spctlAssessArgs(artifact),
      plan.outputPath,
      artifact.artifactPath
    )
    steps.push(assess.step)
    return {
      artifact: {
        kind: artifact.kind,
        artifactPath: artifact.artifactPath,
        alreadyStapled,
        ...(submission?.id === undefined ? {} : { submissionId: submission.id }),
        ...(submission?.status === undefined ? {} : { status: submission.status }),
        assessed: true
      },
      steps
    }
  })

const spctlAssessArgs = (artifact: PackagedArtifact): readonly string[] =>
  artifact.kind === "dmg"
    ? [
        "--assess",
        "--type",
        "open",
        "--context",
        "context:primary-signature",
        "--verbose=4",
        artifact.artifactPath
      ]
    : ["--assess", "--type", "execute", "--verbose=4", artifact.artifactPath]

const runToolStep = (
  options: DesktopNotarizeOptions,
  name: Exclude<NotarizeStepName, "metadata">,
  command: string,
  args: readonly string[],
  cwd: string,
  outputPath: string,
  allowNonZero = false,
  reportArgs: readonly string[] = args
): Effect.Effect<
  { readonly step: NotarizeStepReport; readonly output: NotarizeCommandOutput },
  NotarizeCommandFailedError,
  never
> =>
  Effect.gen(function* () {
    const start = options.now()
    const output = yield* options.commandRunner({ step: name, command, args, cwd })
    const step = {
      name,
      command: [command, ...reportArgs],
      cwd,
      elapsedMs: Math.max(0, options.now() - start),
      outputPath,
      ...(output.stdout.length === 0 ? {} : { stdout: output.stdout }),
      ...(output.stderr.length === 0 ? {} : { stderr: output.stderr })
    } satisfies NotarizeStepReport
    if (!allowNonZero && output.exitCode !== 0) {
      return yield* Effect.fail(
        new NotarizeCommandFailedError({
          step: name,
          command: [command, ...reportArgs],
          cwd,
          exitCode: output.exitCode,
          message: `${name} command exited with ${output.exitCode}`,
          ...(output.stdout.length === 0 ? {} : { stdout: output.stdout }),
          ...(output.stderr.length === 0 ? {} : { stderr: output.stderr })
        })
      )
    }
    return { step, output }
  })

interface NotarySubmission {
  readonly id: string | undefined
  readonly status: string
}

const parseSubmission = (
  stdout: string,
  stderr: string
): Effect.Effect<NotarySubmission, NotarizeCommandFailedError, never> =>
  Effect.try({
    try: () => (stdout.length === 0 ? undefined : (JSON.parse(stdout) as unknown)),
    catch: (cause) =>
      new NotarizeCommandFailedError({
        step: "notarytool-submit",
        command: ["xcrun", "notarytool", "submit"],
        cwd: "",
        exitCode: undefined,
        message: `failed to parse notarytool JSON output: ${formatUnknownError(cause)}`,
        stdout,
        stderr
      })
  }).pipe(
    Effect.flatMap((value) =>
      isRecord(value) && typeof value["status"] === "string"
        ? Effect.succeed({
            id: typeof value["id"] === "string" ? value["id"] : undefined,
            status: value["status"]
          })
        : Effect.fail(
            new NotarizeCommandFailedError({
              step: "notarytool-submit",
              command: ["xcrun", "notarytool", "submit"],
              cwd: "",
              exitCode: undefined,
              message: "notarytool JSON output did not contain a status",
              stdout,
              stderr
            })
          )
    )
  )

const normalizeNotarizePlan = (
  rawConfig: unknown,
  options: { readonly configPath: string; readonly target: NotarizeTarget }
): Effect.Effect<NotarizePlan, NotarizeConfigError, never> =>
  Effect.gen(function* () {
    const config = yield* readConfigObject(rawConfig)
    const appRoot = dirname(options.configPath)
    const appId = yield* readRequiredString(config.app?.id, "app.id", "Set app.id.")
    const appName = yield* readRequiredString(config.app?.name, "app.name", "Set app.name.")
    const appVersion = yield* readRequiredString(
      config.app?.version,
      "app.version",
      "Set app.version."
    )
    return {
      appId,
      appName,
      appVersion,
      appRoot,
      outputPath: resolvePath(appRoot, join("dist", "desktop", "macos")),
      target: options.target,
      config
    }
  })

const resolveCredentials = (
  config: AppConfig
): Effect.Effect<NotaryCredentials, NotarizeConfigError, never> =>
  Effect.gen(function* () {
    const macos = config.signing?.macos
    const profile =
      (yield* readOptionalString(macos?.notarytoolProfile, "signing.macos.notarytoolProfile")) ??
      process.env["APPLE_NOTARYTOOL_PROFILE"]
    if (profile !== undefined && profile.length > 0) {
      return {
        args: ["--keychain-profile", profile],
        reportArgs: ["--keychain-profile", profile]
      }
    }
    const appleId =
      (yield* readOptionalString(macos?.appleId, "signing.macos.appleId")) ??
      process.env["APPLE_ID"]
    const teamId =
      (yield* readOptionalString(macos?.teamId, "signing.macos.teamId")) ??
      process.env["APPLE_TEAM_ID"]
    const passwordEnv =
      (yield* readOptionalString(macos?.passwordEnv, "signing.macos.passwordEnv")) ??
      "APPLE_APP_SPECIFIC_PASSWORD"
    const password = process.env[passwordEnv]
    if (
      appleId !== undefined &&
      teamId !== undefined &&
      password !== undefined &&
      password.length > 0
    ) {
      return {
        args: ["--apple-id", appleId, "--team-id", teamId, "--password", password],
        reportArgs: ["--apple-id", appleId, "--team-id", teamId, "--password", "<redacted>"]
      }
    }
    return yield* Effect.fail(
      new NotarizeConfigError({
        field: "signing.macos.notarytoolProfile",
        message: "notarization requires a keychain profile or Apple ID credentials",
        remediation:
          "Set signing.macos.notarytoolProfile, APPLE_NOTARYTOOL_PROFILE, or APPLE_ID/APPLE_TEAM_ID/APPLE_APP_SPECIFIC_PASSWORD."
      })
    )
  })

const readPackagedArtifacts = (
  plan: NotarizePlan
): Effect.Effect<readonly PackagedArtifact[], NotarizeFileError | NotarizeConfigError, never> =>
  Effect.gen(function* () {
    yield* statPath(plan.outputPath).pipe(
      Effect.catch(() =>
        Effect.fail(
          new NotarizeFileError({
            operation: "discover",
            path: plan.outputPath,
            message: "no macOS packaged artifacts found; run bun desktop package first",
            cause: undefined
          })
        )
      )
    )
    const entries = yield* readDirectory(plan.outputPath)
    const artifacts: PackagedArtifact[] = []
    for (const entry of entries.toSorted()) {
      const rootPath = join(plan.outputPath, entry)
      const rootStat = yield* statPath(rootPath)
      if (!rootStat.isDirectory()) {
        continue
      }
      const metadataPath = join(rootPath, "artifact.json")
      const metadata = yield* readJson<{
        readonly kind?: unknown
        readonly target?: unknown
        readonly fileName?: unknown
        readonly sizeBytes?: unknown
        readonly sha256?: unknown
        readonly appId?: unknown
        readonly appName?: unknown
        readonly appVersion?: unknown
      }>(metadataPath)
      const appIdField = `${relative(plan.outputPath, metadataPath)}#appId`
      const appNameField = `${relative(plan.outputPath, metadataPath)}#appName`
      const appVersionField = `${relative(plan.outputPath, metadataPath)}#appVersion`
      const appId = yield* readRequiredString(
        metadata.appId,
        appIdField,
        "Regenerate package metadata with `bun desktop package`."
      )
      const appName = yield* readRequiredString(
        metadata.appName,
        appNameField,
        "Regenerate package metadata with `bun desktop package`."
      )
      const appVersion = yield* readRequiredString(
        metadata.appVersion,
        appVersionField,
        "Regenerate package metadata with `bun desktop package`."
      )
      if (appId !== plan.appId) {
        return yield* Effect.fail(
          new NotarizeConfigError({
            field: appIdField,
            message: `${appIdField} ${appId} does not match active app.id ${plan.appId}`,
            remediation: "Run `bun desktop package` with the active config before notarizing."
          })
        )
      }
      if (appName !== plan.appName) {
        return yield* Effect.fail(
          new NotarizeConfigError({
            field: appNameField,
            message: `${appNameField} ${appName} does not match active app.name ${plan.appName}`,
            remediation: "Run `bun desktop package` with the active config before notarizing."
          })
        )
      }
      if (appVersion !== plan.appVersion) {
        return yield* Effect.fail(
          new NotarizeConfigError({
            field: appVersionField,
            message: `${appVersionField} ${appVersion} does not match active app.version ${plan.appVersion}`,
            remediation: "Run `bun desktop package` with the active config before notarizing."
          })
        )
      }
      const target = yield* readTarget(
        metadata.target,
        `${relative(plan.outputPath, metadataPath)}#target`
      )
      if (target !== plan.target) {
        continue
      }
      const kind = yield* readArtifactKind(metadata.kind, metadataPath)
      if (kind === undefined) {
        continue
      }
      const fileName = yield* readRequiredString(
        metadata.fileName,
        `${relative(plan.outputPath, metadataPath)}#fileName`,
        "Run `bun desktop package` before `bun desktop notarize`."
      )
      const artifactPath = yield* resolveArtifactPath(rootPath, fileName, metadataPath)
      yield* statPath(artifactPath)
      const sizeBytes = yield* readNonNegativeInteger(
        metadata.sizeBytes,
        `${relative(plan.outputPath, metadataPath)}#sizeBytes`
      )
      const sha256 = yield* readSha256(
        metadata.sha256,
        `${relative(plan.outputPath, metadataPath)}#sha256`
      )
      const digest = yield* digestPath(artifactPath)
      if (digest.sizeBytes !== sizeBytes || digest.sha256 !== sha256) {
        return yield* Effect.fail(
          new NotarizeFileError({
            operation: "verify",
            path: artifactPath,
            message: `${relative(plan.outputPath, artifactPath)} does not match package artifact metadata`,
            cause: undefined
          })
        )
      }
      artifacts.push({ kind, rootPath, artifactPath, appId, appName, appVersion })
    }
    if (artifacts.length === 0) {
      return yield* Effect.fail(
        new NotarizeFileError({
          operation: "discover",
          path: plan.outputPath,
          message: "no directly notarizable macOS artifacts found",
          cause: undefined
        })
      )
    }
    return artifacts
  })

const readConfigObject = (
  rawConfig: unknown
): Effect.Effect<AppConfig, NotarizeConfigError, never> =>
  isRecord(rawConfig)
    ? Effect.succeed(rawConfig as AppConfig)
    : Effect.fail(
        new NotarizeConfigError({
          field: "default",
          message: "desktop config must export an object",
          remediation: "Export a default object from desktop.config.ts."
        })
      )

const readRequiredString = (
  value: unknown,
  field: string,
  remediation: string
): Effect.Effect<string, NotarizeConfigError, never> =>
  typeof value === "string" && value.length > 0
    ? Effect.succeed(value)
    : Effect.fail(new NotarizeConfigError({ field, message: `${field} is required`, remediation }))

const readOptionalString = (
  value: unknown,
  field: string
): Effect.Effect<string | undefined, NotarizeConfigError, never> => {
  if (value === undefined) {
    return Effect.succeed(undefined)
  }
  if (typeof value === "string" && value.length > 0) {
    return Effect.succeed(value)
  }
  return Effect.fail(
    new NotarizeConfigError({
      field,
      message: `${field} must be a non-empty string when provided`,
      remediation: `Remove ${field} or set it to a non-empty string.`
    })
  )
}

const readArtifactKind = (
  value: unknown,
  path: string
): Effect.Effect<NotarizeArtifactKind | undefined, NotarizeConfigError, never> => {
  if (value === "app" || value === "dmg") {
    return Effect.succeed(value)
  }
  if (value === "zip") {
    return Effect.succeed(undefined)
  }
  return Effect.fail(
    new NotarizeConfigError({
      field: `${path}#kind`,
      message: `unsupported macOS notarization artifact kind ${String(value)}`,
      remediation: "Regenerate macOS artifacts with `bun desktop package`."
    })
  )
}

const readTarget = (
  value: unknown,
  field: string
): Effect.Effect<NotarizeTarget, NotarizeConfigError, never> =>
  decodeDesktopTarget(value).pipe(
    Effect.flatMap((target) =>
      isMacosDesktopTargetId(target.id)
        ? Effect.succeed(target.id)
        : Effect.fail(
            new NotarizeConfigError({
              field,
              message: `${field} must be a supported notarize target`,
              remediation: "Regenerate macOS artifacts with `bun desktop package`."
            })
          )
    ),
    Effect.mapError((error) =>
      error instanceof NotarizeConfigError
        ? error
        : new NotarizeConfigError({
            field,
            message: `${field} must be a supported notarize target`,
            remediation: "Regenerate macOS artifacts with `bun desktop package`."
          })
    )
  )

const readNonNegativeInteger = (
  value: unknown,
  field: string
): Effect.Effect<number, NotarizeConfigError, never> =>
  Number.isSafeInteger(value) && typeof value === "number" && value >= 0
    ? Effect.succeed(value)
    : Effect.fail(
        new NotarizeConfigError({
          field,
          message: `${field} must be a non-negative integer`,
          remediation: "Regenerate package metadata with `bun desktop package`."
        })
      )

const readSha256 = (
  value: unknown,
  field: string
): Effect.Effect<string, NotarizeConfigError, never> =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new NotarizeConfigError({
          field,
          message: `${field} must be a lowercase SHA-256 hex digest`,
          remediation: "Regenerate package metadata with `bun desktop package`."
        })
      )

const resolveArtifactPath = (
  rootPath: string,
  fileName: string,
  metadataPath: string
): Effect.Effect<string, NotarizeConfigError, never> => {
  const field = `${metadataPath}#fileName`
  const invalid =
    fileName !== basename(fileName) ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes(":") ||
    containsControlCharacter(fileName)

  if (invalid) {
    return Effect.fail(
      new NotarizeConfigError({
        field,
        message: `${field} must be a contained artifact file name`,
        remediation: "Regenerate macOS artifacts with `bun desktop package`."
      })
    )
  }

  const resolvedRoot = resolve(rootPath)
  const artifactPath = resolve(resolvedRoot, fileName)
  if (dirname(artifactPath) !== resolvedRoot) {
    return Effect.fail(
      new NotarizeConfigError({
        field,
        message: `${field} must resolve inside its artifact metadata directory`,
        remediation: "Regenerate macOS artifacts with `bun desktop package`."
      })
    )
  }

  return Effect.succeed(artifactPath)
}

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true
    }
  }
  return false
}

const loadConfig = (path: string): Effect.Effect<unknown, NotarizeConfigError, never> =>
  Effect.gen(function* () {
    const module = yield* Effect.tryPromise({
      try: async () => (await import(pathToFileURL(path).href)) as { readonly default?: unknown },
      catch: (cause) =>
        new NotarizeConfigError({
          field: "default",
          message: `failed to load config ${path}: ${formatUnknownError(cause)}`,
          remediation: "Fix desktop.config.ts before notarizing."
        })
    })
    if (!isRecord(module.default)) {
      return yield* Effect.fail(
        new NotarizeConfigError({
          field: "default",
          message: `config ${path} must export a default object`,
          remediation: "Export a default object from desktop.config.ts."
        })
      )
    }
    return module.default
  })

const resolveNotarizeTarget = (
  requested: string | undefined,
  hostTarget: DesktopTarget
): Effect.Effect<NotarizeTarget, NotarizeUnsupportedTargetError, never> => {
  const target = requested ?? hostTarget.id
  return decodeDesktopTarget(target).pipe(
    Effect.mapError(
      () =>
        new NotarizeUnsupportedTargetError({
          target: String(target),
          hostTarget: hostTarget.id as NotarizeTarget,
          message: `unsupported notarize target ${String(target)}`,
          remediation: "Notarization is macOS-only. Run on a macOS host."
        })
    ),
    Effect.flatMap((decoded) => {
      if (!isMacosDesktopTargetId(decoded.id)) {
        return Effect.fail(
          new NotarizeUnsupportedTargetError({
            target: decoded.id,
            hostTarget: hostTarget.id as NotarizeTarget,
            message: `unsupported notarize target ${decoded.id}`,
            remediation: "Notarization is macOS-only. Run on a macOS host."
          })
        )
      }
      if (decoded.id !== hostTarget.id) {
        return Effect.fail(
          new NotarizeUnsupportedTargetError({
            target: decoded.id,
            hostTarget: hostTarget.id as NotarizeTarget,
            message: `target ${decoded.id} does not match host ${hostTarget.id}`,
            remediation:
              "Cross-platform notarization is out of scope. Notarize on the matching macOS host."
          })
        )
      }
      return Effect.succeed(decoded.id)
    })
  )
}

const resolveHostTarget = (
  override: NotarizeTarget | undefined
): Effect.Effect<DesktopTarget, NotarizeUnsupportedHostError, never> =>
  resolveMacosDesktopHostTarget(override).pipe(
    Effect.mapError(
      (error: UnsupportedDesktopHostTargetError) =>
        new NotarizeUnsupportedHostError({
          platform: error.platform,
          arch: error.arch,
          message: `unsupported notarize host ${error.platform}-${error.arch}`,
          remediation: "Run notarization on macOS x64 or arm64."
        })
    )
  )

const readJson = <A>(path: string): Effect.Effect<A, NotarizeFileError, never> =>
  Effect.tryPromise({
    try: async () => JSON.parse(await readFile(path, "utf8")) as A,
    catch: (cause) =>
      new NotarizeFileError({
        operation: "read-json",
        path,
        message: `failed to read JSON ${path}`,
        cause
      })
  })

const writeJson = (path: string, value: unknown): Effect.Effect<void, NotarizeFileError, never> =>
  writeFileEffect(path, `${JSON.stringify(value, null, 2)}\n`)

const writeFileEffect = (
  path: string,
  content: string
): Effect.Effect<void, NotarizeFileError, never> =>
  Effect.gen(function* () {
    yield* makeDirectory(dirname(path))
    yield* Effect.tryPromise({
      try: () => writeFile(path, content),
      catch: (cause) =>
        new NotarizeFileError({
          operation: "write",
          path,
          message: `failed to write ${path}`,
          cause
        })
    })
  })

const makeDirectory = (path: string): Effect.Effect<void, NotarizeFileError, never> =>
  Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }),
    catch: (cause) =>
      new NotarizeFileError({
        operation: "mkdir",
        path,
        message: `failed to create ${path}`,
        cause
      })
  }).pipe(Effect.asVoid)

const readDirectory = (path: string): Effect.Effect<readonly string[], NotarizeFileError, never> =>
  Effect.tryPromise({
    try: () => readdir(path),
    catch: (cause) =>
      new NotarizeFileError({
        operation: "readdir",
        path,
        message: `failed to read ${path}`,
        cause
      })
  })

const readBytes = (path: string): Effect.Effect<Buffer, NotarizeFileError, never> =>
  Effect.tryPromise({
    try: () => readFile(path),
    catch: (cause) =>
      new NotarizeFileError({
        operation: "read",
        path,
        message: `failed to read ${path}`,
        cause
      })
  })

const statPath = (
  path: string
): Effect.Effect<Awaited<ReturnType<typeof stat>>, NotarizeFileError, never> =>
  Effect.tryPromise({
    try: () => stat(path),
    catch: (cause) =>
      new NotarizeFileError({
        operation: "stat",
        path,
        message: `failed to stat ${path}`,
        cause
      })
  })

const digestPath = (
  path: string
): Effect.Effect<
  { readonly sizeBytes: number; readonly sha256: string },
  NotarizeFileError,
  never
> =>
  Effect.gen(function* () {
    const pathStat = yield* statPath(path)
    if (!pathStat.isDirectory()) {
      const content = yield* readBytes(path)
      return {
        sizeBytes: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex")
      }
    }

    const entries = yield* listDigestEntries(path)
    const hash = createHash("sha256")
    let sizeBytes = 0
    for (const entry of entries.toSorted((left, right) =>
      left.relativePath.localeCompare(right.relativePath)
    )) {
      hash.update(entry.kind)
      hash.update("\0")
      hash.update(entry.relativePath)
      hash.update("\0")
      hash.update((entry.mode & 0o777).toString(8))
      hash.update("\0")
      if (entry.kind !== "file") {
        hash.update(entry.target)
        hash.update("\0")
        continue
      }
      const content = yield* readBytes(entry.absolutePath)
      sizeBytes += content.byteLength
      hash.update(content)
      hash.update("\0")
    }
    return { sizeBytes, sha256: hash.digest("hex") }
  })

type DigestEntryKind = "directory" | "file" | "symlink"

interface DigestEntry {
  readonly absolutePath: string
  readonly kind: DigestEntryKind
  readonly relativePath: string
  readonly mode: number
  readonly target: string
}

const listDigestEntries = (
  path: string
): Effect.Effect<readonly DigestEntry[], NotarizeFileError, never> => walkDigestEntries(path, path)

const walkDigestEntries = (
  rootPath: string,
  currentPath: string
): Effect.Effect<readonly DigestEntry[], NotarizeFileError, never> =>
  Effect.gen(function* () {
    const entries = yield* readDirectory(currentPath)
    const files: DigestEntry[] = []
    for (const entry of entries.toSorted()) {
      const childPath = join(currentPath, entry)
      const childStat = yield* lstatPath(childPath)
      const childRelativePath = relative(rootPath, childPath)
      if (childStat.isDirectory()) {
        files.push({
          absolutePath: childPath,
          kind: "directory",
          relativePath: childRelativePath,
          mode: Number(childStat.mode),
          target: ""
        })
        files.push(...(yield* walkDigestEntries(rootPath, childPath)))
      } else if (childStat.isSymbolicLink()) {
        const target = yield* readlinkPath(childPath)
        files.push({
          absolutePath: childPath,
          kind: "symlink",
          relativePath: childRelativePath,
          mode: Number(childStat.mode),
          target
        })
      } else {
        files.push({
          absolutePath: childPath,
          kind: "file",
          relativePath: childRelativePath,
          mode: Number(childStat.mode),
          target: ""
        })
      }
    }
    return files
  })

const lstatPath = (
  path: string
): Effect.Effect<Awaited<ReturnType<typeof lstat>>, NotarizeFileError, never> =>
  Effect.tryPromise({
    try: () => lstat(path),
    catch: (cause) =>
      new NotarizeFileError({
        operation: "lstat",
        path,
        message: `failed to lstat ${path}`,
        cause
      })
  })

const readlinkPath = (path: string): Effect.Effect<string, NotarizeFileError, never> =>
  Effect.tryPromise({
    try: () => readlink(path),
    catch: (cause) =>
      new NotarizeFileError({
        operation: "readlink",
        path,
        message: `failed to read symlink ${path}`,
        cause
      })
  })

const resolvePath = (cwd: string, path: string): string =>
  isAbsolute(path) ? path : resolve(cwd, path)

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null

const formatUnknownError = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const readStreamText = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const read = await reader.read()
    if (read.done) {
      break
    }
    chunks.push(read.value)
  }
  return await new Blob(chunks).text()
}
