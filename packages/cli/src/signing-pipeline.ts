import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"

import { Data, Effect } from "effect"

export type SignOs = "linux" | "macos" | "windows"
export type SignArch = "arm64" | "x64"
export type SignTarget = `${SignOs}-${SignArch}`
export type SignPlatform = "linux" | "macos" | "windows"
export type SignArtifactKind = "app" | "dmg" | "zip" | "msi" | "appimage" | "deb" | "rpm"
export type SignStepName =
  | "macos-entitlements"
  | "macos-codesign"
  | "windows-authenticode"
  | "windows-unblock"
  | "linux-appstream"
  | "linux-desktop"
  | "linux-gpg"
  | "metadata"

export class SignConfigError extends Data.TaggedError("SignConfigError")<{
  readonly field: string
  readonly message: string
  readonly remediation: string
}> {}

export class SignUnsupportedHostError extends Data.TaggedError("SignUnsupportedHostError")<{
  readonly platform: string
  readonly arch: string
  readonly message: string
  readonly remediation: string
}> {}

export class SignUnsupportedTargetError extends Data.TaggedError("SignUnsupportedTargetError")<{
  readonly target: string
  readonly hostTarget: SignTarget
  readonly message: string
  readonly remediation: string
}> {}

export class SignFileError extends Data.TaggedError("SignFileError")<{
  readonly operation: string
  readonly path: string
  readonly message: string
  readonly cause: unknown
}> {}

export class SignCommandFailedError extends Data.TaggedError("SignCommandFailedError")<{
  readonly step: SignStepName
  readonly command: readonly string[]
  readonly cwd: string
  readonly exitCode: number | undefined
  readonly message: string
  readonly stderr?: string
}> {}

export type SignPipelineError =
  | SignConfigError
  | SignUnsupportedHostError
  | SignUnsupportedTargetError
  | SignFileError
  | SignCommandFailedError

export interface SignCommandInvocation {
  readonly step: SignStepName
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}

export type SignCommandRunner = (
  invocation: SignCommandInvocation
) => Effect.Effect<void, SignCommandFailedError, never>

export interface DesktopSignOptions {
  readonly cwd: string
  readonly configPath: string
  readonly platform: string | undefined
  readonly commandRunner: SignCommandRunner
  readonly now: () => number
  readonly hostTarget: SignTarget | undefined
}

export interface SignStepReport {
  readonly name: SignStepName
  readonly command?: readonly string[]
  readonly cwd?: string
  readonly elapsedMs: number
  readonly outputPath: string
}

export interface SignArtifactReport {
  readonly kind: SignArtifactKind
  readonly artifactPath: string
  readonly signedPaths: readonly string[]
  readonly signaturePath?: string
}

export interface DesktopSignReport {
  readonly appId: string
  readonly appName: string
  readonly appVersion: string
  readonly target: SignTarget
  readonly outputPath: string
  readonly artifacts: readonly SignArtifactReport[]
  readonly steps: readonly SignStepReport[]
}

interface AppConfig {
  readonly app?: {
    readonly id?: unknown
    readonly name?: unknown
    readonly version?: unknown
  }
  readonly security?: {
    readonly permissions?: unknown
  }
  readonly permissions?: unknown
  readonly signing?: {
    readonly macos?: {
      readonly identity?: unknown
      readonly teamId?: unknown
      readonly entitlements?: unknown
    }
    readonly windows?: {
      readonly thumbprint?: unknown
      readonly timestampUrl?: unknown
      readonly pfx?: {
        readonly path?: unknown
        readonly passwordEnv?: unknown
      }
    }
    readonly linux?: {
      readonly gpgKey?: unknown
    }
  }
}

interface SignPlan {
  readonly appId: string
  readonly appName: string
  readonly appVersion: string
  readonly appRoot: string
  readonly outputPath: string
  readonly target: SignTarget
  readonly platform: SignPlatform
  readonly safeAppName: string
  readonly config: AppConfig
}

interface PackagedArtifact {
  readonly appId: string
  readonly appName: string
  readonly appVersion: string
  readonly kind: SignArtifactKind
  readonly rootPath: string
  readonly artifactPath: string
  readonly linuxIntegration: LinuxIntegration | undefined
}

interface LinuxIntegration {
  readonly desktopFile: string
  readonly appStreamId: string
  readonly snapName: string
}

const DEFAULT_TIMESTAMP_URL = "http://timestamp.digicert.com"

export const runDesktopSign = (
  options: DesktopSignOptions
): Effect.Effect<DesktopSignReport, SignPipelineError, never> =>
  Effect.gen(function* () {
    const absoluteConfigPath = resolvePath(options.cwd, options.configPath)
    const rawConfig = yield* loadConfig(absoluteConfigPath)
    const hostTarget = yield* resolveHostTarget(options.hostTarget)
    const target = yield* resolveSignTarget(options.platform, hostTarget)
    const plan = yield* normalizeSignPlan(rawConfig, {
      configPath: absoluteConfigPath,
      target
    })
    const artifacts = yield* readPackagedArtifacts(plan)
    const steps: SignStepReport[] = []
    const reports: SignArtifactReport[] = []

    for (const artifact of artifacts) {
      const signed = yield* signArtifact(options, plan, artifact)
      steps.push(...signed.steps)
      reports.push(signed.artifact)
    }

    const metadataStep: SignStepReport = {
      name: "metadata",
      elapsedMs: 0,
      outputPath: join(plan.outputPath, "sign-report.json")
    }
    steps.push(metadataStep)
    const report: DesktopSignReport = {
      appId: plan.appId,
      appName: plan.appName,
      appVersion: plan.appVersion,
      target: plan.target,
      outputPath: plan.outputPath,
      artifacts: reports,
      steps
    }
    yield* writeJson(join(plan.outputPath, "sign-report.json"), report)
    return report
  })

export const detectSignHostTarget = (): SignTarget | undefined => {
  const os = process.platform === "darwin" ? "macos" : process.platform
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : undefined
  if ((os === "linux" || os === "macos" || os === "win32") && arch !== undefined) {
    return `${os === "win32" ? "windows" : os}-${arch}` as SignTarget
  }
  return undefined
}

export const runSignCommand: SignCommandRunner = (invocation) =>
  Effect.tryPromise({
    try: async () => {
      const spawned = Bun.spawn([invocation.command, ...invocation.args], {
        cwd: invocation.cwd,
        stdout: "ignore",
        stderr: "pipe"
      })
      const stderr = await readStreamText(spawned.stderr)
      const exitCode = await spawned.exited
      if (exitCode !== 0) {
        const failure = {
          step: invocation.step,
          command: [invocation.command, ...invocation.args],
          cwd: invocation.cwd,
          exitCode,
          message: `${invocation.step} command exited with ${exitCode}`
        }
        throw new SignCommandFailedError(stderr.length === 0 ? failure : { ...failure, stderr })
      }
    },
    catch: (cause) =>
      cause instanceof SignCommandFailedError
        ? cause
        : new SignCommandFailedError({
            step: invocation.step,
            command: [invocation.command, ...invocation.args],
            cwd: invocation.cwd,
            exitCode: undefined,
            message: formatUnknownError(cause)
          })
  })

const signArtifact = (
  options: DesktopSignOptions,
  plan: SignPlan,
  artifact: PackagedArtifact
): Effect.Effect<
  { readonly artifact: SignArtifactReport; readonly steps: readonly SignStepReport[] },
  SignPipelineError,
  never
> => {
  switch (artifact.kind) {
    case "app":
      return signMacosApp(options, plan, artifact)
    case "msi":
      return signWindowsArtifact(options, plan, artifact)
    case "appimage":
      return signLinuxAppImage(options, plan, artifact)
    case "dmg":
      return signMacosDmg(options, plan, artifact)
    case "zip":
    case "deb":
    case "rpm":
      return Effect.fail(
        new SignConfigError({
          field: `${artifact.kind}`,
          message: `${artifact.kind} artifacts are not directly signable by this signer`,
          remediation: "Sign the platform's signable artifact produced by `bun desktop package`."
        })
      )
  }
}

const signMacosApp = (
  options: DesktopSignOptions,
  plan: SignPlan,
  artifact: PackagedArtifact
): Effect.Effect<
  { readonly artifact: SignArtifactReport; readonly steps: readonly SignStepReport[] },
  SignPipelineError,
  never
> =>
  Effect.gen(function* () {
    const identity = yield* readRequiredString(
      plan.config.signing?.macos?.identity,
      "signing.macos.identity",
      "Configure signing.macos.identity with a Developer ID Application identity."
    )
    const entitlementsPath = join(artifact.rootPath, "effect-desktop-entitlements.plist")
    const entitlementStart = options.now()
    const entitlements = yield* macosEntitlementsPlist(plan.config)
    yield* writeFileEffect(entitlementsPath, entitlements)
    const steps: SignStepReport[] = [
      {
        name: "macos-entitlements",
        elapsedMs: Math.max(0, options.now() - entitlementStart),
        outputPath: entitlementsPath
      }
    ]
    const signablePaths = yield* macosSignablePaths(artifact.artifactPath)
    const signedPaths: string[] = []
    for (const path of [...signablePaths, artifact.artifactPath]) {
      const step = yield* runToolStep(
        options,
        "macos-codesign",
        "codesign",
        [
          "--force",
          "--sign",
          identity,
          "--options",
          "runtime",
          "--entitlements",
          entitlementsPath,
          path
        ],
        plan.outputPath,
        path
      )
      steps.push(step)
      signedPaths.push(path)
    }
    return {
      artifact: { kind: artifact.kind, artifactPath: artifact.artifactPath, signedPaths },
      steps
    }
  })

const signMacosDmg = (
  options: DesktopSignOptions,
  plan: SignPlan,
  artifact: PackagedArtifact
): Effect.Effect<
  { readonly artifact: SignArtifactReport; readonly steps: readonly SignStepReport[] },
  SignPipelineError,
  never
> =>
  Effect.gen(function* () {
    const identity = yield* readRequiredString(
      plan.config.signing?.macos?.identity,
      "signing.macos.identity",
      "Configure signing.macos.identity with a Developer ID Application identity."
    )
    const step = yield* runToolStep(
      options,
      "macos-codesign",
      "codesign",
      ["--force", "--sign", identity, artifact.artifactPath],
      plan.outputPath,
      artifact.artifactPath
    )
    return {
      artifact: {
        kind: artifact.kind,
        artifactPath: artifact.artifactPath,
        signedPaths: [artifact.artifactPath]
      },
      steps: [step]
    }
  })

const signWindowsArtifact = (
  options: DesktopSignOptions,
  plan: SignPlan,
  artifact: PackagedArtifact
): Effect.Effect<
  { readonly artifact: SignArtifactReport; readonly steps: readonly SignStepReport[] },
  SignPipelineError,
  never
> =>
  Effect.gen(function* () {
    const windows = plan.config.signing?.windows
    const timestampUrl =
      (yield* readOptionalString(windows?.timestampUrl, "signing.windows.timestampUrl")) ??
      DEFAULT_TIMESTAMP_URL
    const credential = yield* windowsCredentialArgs(windows)
    const steps: SignStepReport[] = []
    const unblockStep = yield* runToolStep(
      options,
      "windows-unblock",
      "powershell",
      ["-NoProfile", "-Command", "Unblock-File", "-Path", artifact.artifactPath],
      plan.outputPath,
      artifact.artifactPath
    )
    steps.push(unblockStep)
    const signStep = yield* runToolStep(
      options,
      "windows-authenticode",
      "signtool",
      [
        "sign",
        "/fd",
        "SHA256",
        "/tr",
        timestampUrl,
        "/td",
        "SHA256",
        ...credential.args,
        artifact.artifactPath
      ],
      plan.outputPath,
      artifact.artifactPath,
      [
        "sign",
        "/fd",
        "SHA256",
        "/tr",
        timestampUrl,
        "/td",
        "SHA256",
        ...credential.reportArgs,
        artifact.artifactPath
      ]
    )
    steps.push(signStep)
    return {
      artifact: {
        kind: artifact.kind,
        artifactPath: artifact.artifactPath,
        signedPaths: [artifact.artifactPath]
      },
      steps
    }
  })

const signLinuxAppImage = (
  options: DesktopSignOptions,
  plan: SignPlan,
  artifact: PackagedArtifact
): Effect.Effect<
  { readonly artifact: SignArtifactReport; readonly steps: readonly SignStepReport[] },
  SignPipelineError,
  never
> =>
  Effect.gen(function* () {
    const gpgKey = yield* readRequiredString(
      plan.config.signing?.linux?.gpgKey,
      "signing.linux.gpgKey",
      "Configure signing.linux.gpgKey before signing Linux AppImages."
    )
    if (artifact.linuxIntegration === undefined) {
      return yield* Effect.fail(
        new SignConfigError({
          field: "artifact.json#linuxIntegration",
          message: "Linux signable artifacts must include linuxIntegration metadata",
          remediation: "Regenerate package metadata with `bun desktop package`."
        })
      )
    }
    const appstreamPath = join(
      artifact.rootPath,
      "share",
      "metainfo",
      artifact.linuxIntegration.appStreamId
    )
    const desktopPath = join(
      artifact.rootPath,
      "share",
      "applications",
      artifact.linuxIntegration.desktopFile
    )
    const appstreamStart = options.now()
    yield* writeFileEffect(appstreamPath, appstreamMetainfo(plan, artifact.linuxIntegration))
    const desktopStart = options.now()
    yield* writeFileEffect(desktopPath, linuxDesktopEntry(plan, artifact.linuxIntegration))
    const signaturePath = `${artifact.artifactPath}.asc`
    const steps: SignStepReport[] = [
      {
        name: "linux-appstream",
        elapsedMs: Math.max(0, desktopStart - appstreamStart),
        outputPath: appstreamPath
      },
      {
        name: "linux-desktop",
        elapsedMs: Math.max(0, options.now() - desktopStart),
        outputPath: desktopPath
      }
    ]
    const signStep = yield* runToolStep(
      options,
      "linux-gpg",
      "gpg",
      [
        "--batch",
        "--yes",
        "--armor",
        "--detach-sign",
        "--local-user",
        gpgKey,
        "--output",
        signaturePath,
        artifact.artifactPath
      ],
      plan.outputPath,
      signaturePath
    )
    steps.push(signStep)
    return {
      artifact: {
        kind: artifact.kind,
        artifactPath: artifact.artifactPath,
        signedPaths: [artifact.artifactPath],
        signaturePath
      },
      steps
    }
  })

const runToolStep = (
  options: DesktopSignOptions,
  name: Exclude<
    SignStepName,
    "macos-entitlements" | "linux-appstream" | "linux-desktop" | "metadata"
  >,
  command: string,
  args: readonly string[],
  cwd: string,
  outputPath: string,
  reportArgs: readonly string[] = args
): Effect.Effect<SignStepReport, SignCommandFailedError | SignFileError, never> =>
  Effect.gen(function* () {
    const start = options.now()
    yield* options.commandRunner({ step: name, command, args, cwd })
    yield* statPath(outputPath)
    return {
      name,
      command: [command, ...reportArgs],
      cwd,
      elapsedMs: Math.max(0, options.now() - start),
      outputPath
    }
  })

const normalizeSignPlan = (
  rawConfig: unknown,
  options: { readonly configPath: string; readonly target: SignTarget }
): Effect.Effect<SignPlan, SignConfigError, never> =>
  Effect.gen(function* () {
    const config = yield* readConfigObject(rawConfig)
    const appRoot = dirname(options.configPath)
    const appId = yield* readSafeAppId(config.app?.id, "app.id")
    const appName = yield* readRequiredString(
      config.app?.name,
      "app.name",
      "Set app.name in desktop.config.ts."
    )
    const appVersion = yield* readRequiredString(
      config.app?.version,
      "app.version",
      "Set app.version in desktop.config.ts."
    )
    const platform = platformFromTarget(options.target)
    const safeAppName = safeArtifactName(appName)
    if (safeAppName === "." || safeAppName === "..") {
      return yield* Effect.fail(
        new SignConfigError({
          field: "app.name",
          message: "app.name must not sanitize to . or ..",
          remediation: "Set app.name in desktop.config.ts."
        })
      )
    }
    return {
      appId,
      appName,
      appVersion,
      appRoot,
      outputPath: resolvePath(appRoot, join("dist", "desktop", platform)),
      target: options.target,
      platform,
      safeAppName,
      config
    }
  })

const readPackagedArtifacts = (
  plan: SignPlan
): Effect.Effect<readonly PackagedArtifact[], SignFileError | SignConfigError, never> =>
  Effect.gen(function* () {
    yield* statPath(plan.outputPath).pipe(
      Effect.catch(() =>
        Effect.fail(
          new SignFileError({
            operation: "discover",
            path: plan.outputPath,
            message: `no ${plan.platform} packaged artifacts found; run bun desktop package first`,
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
        readonly linuxIntegration?: unknown
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
          new SignConfigError({
            field: appIdField,
            message: `${appIdField} ${appId} does not match active app.id ${plan.appId}`,
            remediation: "Run `bun desktop package` with the active config before signing."
          })
        )
      }
      if (appName !== plan.appName) {
        return yield* Effect.fail(
          new SignConfigError({
            field: appNameField,
            message: `${appNameField} ${appName} does not match active app.name ${plan.appName}`,
            remediation: "Run `bun desktop package` with the active config before signing."
          })
        )
      }
      if (appVersion !== plan.appVersion) {
        return yield* Effect.fail(
          new SignConfigError({
            field: appVersionField,
            message: `${appVersionField} ${appVersion} does not match active app.version ${plan.appVersion}`,
            remediation: "Run `bun desktop package` with the active config before signing."
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
      const fileNameField = `${relative(plan.outputPath, metadataPath)}#fileName`
      const fileName = yield* readContainedFileName(metadata.fileName, fileNameField)
      const artifactPath = yield* resolveContainedArtifactPath(rootPath, fileName, fileNameField)
      yield* statPath(artifactPath)
      const linuxIntegration = yield* readLinuxIntegration(
        metadata.linuxIntegration,
        relative(plan.outputPath, metadataPath)
      )
      artifacts.push({ kind, rootPath, artifactPath, linuxIntegration, appId, appName, appVersion })
    }
    const relevant = artifacts.filter(
      (artifact) =>
        artifactPlatform(artifact.kind) === plan.platform && isSignableArtifact(artifact)
    )
    if (relevant.length === 0) {
      return yield* Effect.fail(
        new SignFileError({
          operation: "discover",
          path: plan.outputPath,
          message: `no ${plan.platform} packaged artifacts found; run bun desktop package first`,
          cause: undefined
        })
      )
    }
    return relevant
  })

const macosSignablePaths = (
  appPath: string
): Effect.Effect<readonly string[], SignFileError, never> =>
  Effect.gen(function* () {
    const candidates = [
      join(appPath, "Contents", "MacOS"),
      join(appPath, "Contents", "Resources", "effect-desktop", "native"),
      join(appPath, "Contents", "Resources", "effect-desktop", "runtime")
    ]
    const files: string[] = []
    for (const candidate of candidates) {
      const candidateStat = yield* statPath(candidate)
      if (candidateStat.isDirectory()) {
        files.push(...(yield* listFiles(candidate)))
      }
    }
    return files.toSorted((left, right) => left.localeCompare(right))
  }).pipe(Effect.map((files) => files.filter((file) => !file.endsWith(".json"))))

const windowsCredentialArgs = (
  windows: AppConfig["signing"] extends infer Signing
    ? Signing extends { readonly windows?: infer Windows }
      ? Windows | undefined
      : never
    : never
): Effect.Effect<
  { readonly args: readonly string[]; readonly reportArgs: readonly string[] },
  SignConfigError,
  never
> =>
  Effect.gen(function* () {
    const thumbprint = yield* readOptionalString(windows?.thumbprint, "signing.windows.thumbprint")
    if (thumbprint !== undefined) {
      yield* validateWindowsThumbprint(thumbprint)
      return { args: ["/sha1", thumbprint], reportArgs: ["/sha1", thumbprint] }
    }
    const pfxPath = yield* readOptionalString(windows?.pfx?.path, "signing.windows.pfx.path")
    const passwordEnv = yield* readOptionalString(
      windows?.pfx?.passwordEnv,
      "signing.windows.pfx.passwordEnv"
    )
    if (pfxPath !== undefined && passwordEnv !== undefined) {
      const password = process.env[passwordEnv]
      if (password === undefined || password.length === 0) {
        return yield* Effect.fail(
          new SignConfigError({
            field: `env.${passwordEnv}`,
            message: `environment variable ${passwordEnv} is required for signing.windows.pfx.passwordEnv`,
            remediation:
              "Export the PFX password environment variable before signing Windows artifacts."
          })
        )
      }
      return {
        args: ["/f", pfxPath, "/p", password],
        reportArgs: ["/f", pfxPath, "/p", "<redacted>"]
      }
    }
    return yield* Effect.fail(
      new SignConfigError({
        field: "signing.windows",
        message: "signing.windows.thumbprint or signing.windows.pfx.{path,passwordEnv} is required",
        remediation: "Configure an Authenticode certificate before signing Windows artifacts."
      })
    )
  })

const WINDOWS_SHA1_THUMBPRINT_PATTERN = /^[0-9a-fA-F]{40}$/u

const validateWindowsThumbprint = (
  thumbprint: string
): Effect.Effect<void, SignConfigError, never> =>
  WINDOWS_SHA1_THUMBPRINT_PATTERN.test(thumbprint)
    ? Effect.void
    : Effect.fail(
        new SignConfigError({
          field: "signing.windows.thumbprint",
          message: "signing.windows.thumbprint must be a 40-character SHA-1 hex thumbprint",
          remediation:
            "Set signing.windows.thumbprint to the certificate SHA-1 fingerprint without spaces."
        })
      )

const macosEntitlementsPlist = (config: AppConfig): Effect.Effect<string, SignConfigError, never> =>
  Effect.gen(function* () {
    const permissions = yield* permissionNames(config)
    return plist({
      "com.apple.security.cs.allow-jit": true,
      "com.apple.security.allow-dylib-injection": false,
      "com.apple.security.cs.allow-unsigned-executable-memory": false,
      "com.apple.security.cs.disable-library-validation": false,
      "com.apple.security.device.camera": permissions.has("device.camera"),
      "com.apple.security.device.microphone": permissions.has("device.microphone"),
      "com.apple.security.network.client":
        permissions.has("network.client") || permissions.has("network")
    })
  })

const permissionNames = (
  config: AppConfig
): Effect.Effect<ReadonlySet<string>, SignConfigError, never> => {
  const permissions = config.permissions ?? config.security?.permissions
  if (permissions === undefined) {
    return Effect.succeed(new Set())
  }
  if (!Array.isArray(permissions)) {
    return Effect.fail(
      new SignConfigError({
        field: "permissions",
        message: "permissions must be an array",
        remediation: "Declare permissions as an array of capability strings or objects."
      })
    )
  }

  const names = new Set<string>()
  for (const [index, permission] of permissions.entries()) {
    if (typeof permission === "string" && permission.length > 0) {
      names.add(permission)
      continue
    }
    if (isRecord(permission) && typeof permission["name"] === "string") {
      names.add(permission["name"])
      continue
    }
    if (isRecord(permission) && typeof permission["capability"] === "string") {
      names.add(permission["capability"])
      continue
    }
    return Effect.fail(
      new SignConfigError({
        field: `permissions[${index}]`,
        message: `permissions[${index}] must be a string or object with name/capability`,
        remediation: "Use documented permission capability names such as device.camera."
      })
    )
  }

  return Effect.succeed(names)
}

const appstreamMetainfo = (
  plan: SignPlan,
  integration: LinuxIntegration
): string => `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${escapeXml(plan.appId)}</id>
  <name>${escapeXml(plan.appName)}</name>
  <summary>${escapeXml(plan.appName)}</summary>
  <launchable type="desktop-id">${escapeXml(integration.desktopFile)}</launchable>
  <releases>
    <release version="${escapeXml(plan.appVersion)}" />
  </releases>
</component>
`

const linuxDesktopEntry = (plan: SignPlan, integration: LinuxIntegration): string =>
  [
    "[Desktop Entry]",
    `Name=${plan.appName}`,
    `Exec=${integration.snapName}`,
    `Icon=${integration.snapName}`,
    "Type=Application",
    "Categories=Utility;",
    ""
  ].join("\n")

const plist = (values: Readonly<Record<string, boolean>>): string => {
  const entries = Object.entries(values)
    .map(([key, value]) => [`  <key>${escapeXml(key)}</key>`, `  <${value ? "true" : "false"}/>`])
    .flat()
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries}
</dict>
</plist>
`
}

const readConfigObject = (rawConfig: unknown): Effect.Effect<AppConfig, SignConfigError, never> =>
  isRecord(rawConfig)
    ? Effect.succeed(rawConfig as AppConfig)
    : Effect.fail(
        new SignConfigError({
          field: "default",
          message: "desktop config must export an object",
          remediation: "Export a default object from desktop.config.ts."
        })
      )

const readRequiredString = (
  value: unknown,
  field: string,
  remediation: string
): Effect.Effect<string, SignConfigError, never> => {
  if (typeof value === "string" && value.length > 0) {
    return Effect.succeed(value)
  }
  return Effect.fail(new SignConfigError({ field, message: `${field} is required`, remediation }))
}

const readOptionalString = (
  value: unknown,
  field: string
): Effect.Effect<string | undefined, SignConfigError, never> => {
  if (value === undefined) {
    return Effect.succeed(undefined)
  }
  if (typeof value === "string" && value.length > 0) {
    return Effect.succeed(value)
  }
  return Effect.fail(
    new SignConfigError({
      field,
      message: `${field} must be a non-empty string when provided`,
      remediation: `Remove ${field} or set it to a non-empty string.`
    })
  )
}

const readSafeAppId = (
  value: unknown,
  field: string
): Effect.Effect<string, SignConfigError, never> =>
  readRequiredString(value, field, "Set app.id in desktop.config.ts.").pipe(
    Effect.flatMap((appId) =>
      appIdMatch(appId)
        ? Effect.succeed(appId)
        : Effect.fail(
            new SignConfigError({
              field,
              message: `${field} must be a reverse-DNS ASCII identifier`,
              remediation: "Set app.id to a reverse-DNS identifier such as com.example.app."
            })
          )
    )
  )

const readContainedFileName = (
  value: unknown,
  field: string
): Effect.Effect<string, SignConfigError, never> => {
  if (typeof value !== "string" || value.length === 0) {
    return Effect.fail(
      new SignConfigError({
        field,
        message: `${field} is required`,
        remediation: "Run `bun desktop package` before `bun desktop sign`."
      })
    )
  }
  if (!isContainedFileName(value)) {
    return Effect.fail(
      new SignConfigError({
        field,
        message: `${field} must be a single file name without path separators`,
        remediation: "Regenerate package metadata with `bun desktop package`."
      })
    )
  }
  return Effect.succeed(value)
}

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

const appIdMatch = (value: string): boolean =>
  /^([a-zA-Z][a-zA-Z0-9-]*)(\.[a-zA-Z][a-zA-Z0-9-]*)+$/.test(value) && isContainedFileName(value)

const resolveContainedArtifactPath = (
  rootPath: string,
  fileName: string,
  field: string
): Effect.Effect<string, SignConfigError, never> => {
  const candidate = resolve(rootPath, fileName)
  const containedPrefix = `${rootPath}${sep}`
  if (candidate !== rootPath && !candidate.startsWith(containedPrefix)) {
    return Effect.fail(
      new SignConfigError({
        field,
        message: `${field} resolves outside the artifact metadata directory`,
        remediation: "Regenerate package metadata with `bun desktop package`."
      })
    )
  }
  return Effect.succeed(candidate)
}

const readLinuxIntegration = (
  value: unknown,
  metadataRelativePath: string
): Effect.Effect<LinuxIntegration | undefined, SignConfigError, never> => {
  if (value === undefined) {
    return Effect.succeed(undefined)
  }
  if (!isRecord(value)) {
    return Effect.fail(
      new SignConfigError({
        field: `${metadataRelativePath}#linuxIntegration`,
        message: `${metadataRelativePath}#linuxIntegration must be an object`,
        remediation: "Regenerate package metadata with `bun desktop package`."
      })
    )
  }
  const desktopFile = value["desktopFile"]
  const appStreamId = value["appStreamId"]
  const snapName = value["snapName"]
  if (
    typeof desktopFile !== "string" ||
    desktopFile.length === 0 ||
    typeof appStreamId !== "string" ||
    appStreamId.length === 0 ||
    typeof snapName !== "string" ||
    snapName.length === 0
  ) {
    return Effect.fail(
      new SignConfigError({
        field: `${metadataRelativePath}#linuxIntegration`,
        message: `${metadataRelativePath}#linuxIntegration must include desktopFile, appStreamId, and snapName`,
        remediation: "Regenerate package metadata with `bun desktop package`."
      })
    )
  }
  return Effect.succeed({ desktopFile, appStreamId, snapName })
}

const readArtifactKind = (
  value: unknown,
  path: string
): Effect.Effect<SignArtifactKind, SignConfigError, never> => {
  if (isSignArtifactKind(value)) {
    return Effect.succeed(value)
  }
  return Effect.fail(
    new SignConfigError({
      field: `${path}#kind`,
      message: `unsupported artifact kind ${String(value)}`,
      remediation: "Regenerate artifacts with `bun desktop package`."
    })
  )
}

const readTarget = (
  value: unknown,
  field: string
): Effect.Effect<SignTarget, SignConfigError, never> =>
  isSignTarget(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new SignConfigError({
          field,
          message: `${field} must be a supported sign target`,
          remediation: "Regenerate package artifacts with `bun desktop package`."
        })
      )

const loadConfig = (path: string): Effect.Effect<unknown, SignConfigError, never> =>
  Effect.gen(function* () {
    const module = yield* Effect.tryPromise({
      try: async () => (await import(pathToFileURL(path).href)) as { readonly default?: unknown },
      catch: (cause) =>
        new SignConfigError({
          field: "default",
          message: `failed to load config ${path}: ${formatUnknownError(cause)}`,
          remediation: "Fix desktop.config.ts before signing."
        })
    })
    if (!isRecord(module.default)) {
      return yield* Effect.fail(
        new SignConfigError({
          field: "default",
          message: `config ${path} must export a default object`,
          remediation: "Export a default object from desktop.config.ts."
        })
      )
    }
    return module.default
  })

const resolveSignTarget = (
  requested: string | undefined,
  hostTarget: SignTarget
): Effect.Effect<SignTarget, SignUnsupportedTargetError, never> => {
  const target = requested ?? hostTarget
  if (!isSignTarget(target)) {
    return Effect.fail(
      new SignUnsupportedTargetError({
        target,
        hostTarget,
        message: `unsupported sign target ${target}`,
        remediation:
          "Run `bun desktop doctor` on a supported host and choose the matching --platform."
      })
    )
  }
  if (target !== hostTarget) {
    return Effect.fail(
      new SignUnsupportedTargetError({
        target,
        hostTarget,
        message: `target ${target} does not match host ${hostTarget}`,
        remediation: "Cross-platform signing is out of scope. Sign on the matching host."
      })
    )
  }
  return Effect.succeed(target)
}

const resolveHostTarget = (
  override: SignTarget | undefined
): Effect.Effect<SignTarget, SignUnsupportedHostError, never> => {
  const hostTarget = override ?? detectSignHostTarget()
  if (hostTarget !== undefined) {
    return Effect.succeed(hostTarget)
  }
  return Effect.fail(
    new SignUnsupportedHostError({
      platform: process.platform,
      arch: process.arch,
      message: `unsupported host ${process.platform}-${process.arch}`,
      remediation: "Run `bun desktop doctor` on linux, macOS, or Windows with x64 or arm64."
    })
  )
}

const readJson = <A>(path: string): Effect.Effect<A, SignFileError, never> =>
  Effect.tryPromise({
    try: async () => JSON.parse(await readFile(path, "utf8")) as A,
    catch: (cause) =>
      new SignFileError({
        operation: "read-json",
        path,
        message: `failed to read JSON ${path}`,
        cause
      })
  })

const writeJson = (path: string, value: unknown): Effect.Effect<void, SignFileError, never> =>
  writeFileEffect(path, `${JSON.stringify(value, null, 2)}\n`)

const writeFileEffect = (
  path: string,
  content: string
): Effect.Effect<void, SignFileError, never> =>
  Effect.gen(function* () {
    yield* makeDirectory(dirname(path))
    yield* Effect.tryPromise({
      try: () => writeFile(path, content),
      catch: (cause) =>
        new SignFileError({
          operation: "write",
          path,
          message: `failed to write ${path}`,
          cause
        })
    })
  })

const makeDirectory = (path: string): Effect.Effect<void, SignFileError, never> =>
  Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }),
    catch: (cause) =>
      new SignFileError({
        operation: "mkdir",
        path,
        message: `failed to create ${path}`,
        cause
      })
  }).pipe(Effect.asVoid)

const readDirectory = (path: string): Effect.Effect<readonly string[], SignFileError, never> =>
  Effect.tryPromise({
    try: () => readdir(path),
    catch: (cause) =>
      new SignFileError({
        operation: "readdir",
        path,
        message: `failed to read ${path}`,
        cause
      })
  })

const statPath = (
  path: string
): Effect.Effect<Awaited<ReturnType<typeof stat>>, SignFileError, never> =>
  Effect.tryPromise({
    try: () => stat(path),
    catch: (cause) =>
      new SignFileError({
        operation: "stat",
        path,
        message: `failed to stat ${path}`,
        cause
      })
  })

const listFiles = (path: string): Effect.Effect<readonly string[], SignFileError, never> =>
  Effect.gen(function* () {
    const entries = yield* readDirectory(path)
    const files: string[] = []
    for (const entry of entries.toSorted()) {
      const child = join(path, entry)
      const childStat = yield* statPath(child)
      if (childStat.isDirectory()) {
        files.push(...(yield* listFiles(child)))
      } else {
        files.push(child)
      }
    }
    return files
  })

const isSignTarget = (value: unknown): value is SignTarget =>
  value === "linux-x64" ||
  value === "linux-arm64" ||
  value === "macos-x64" ||
  value === "macos-arm64" ||
  value === "windows-x64" ||
  value === "windows-arm64"

const isSignArtifactKind = (value: unknown): value is SignArtifactKind =>
  value === "app" ||
  value === "dmg" ||
  value === "zip" ||
  value === "msi" ||
  value === "appimage" ||
  value === "deb" ||
  value === "rpm"

const isSignableArtifact = (artifact: PackagedArtifact): boolean =>
  artifact.kind === "app" ||
  artifact.kind === "dmg" ||
  artifact.kind === "msi" ||
  artifact.kind === "appimage"

const platformFromTarget = (target: SignTarget): SignPlatform => {
  if (target.startsWith("macos-")) {
    return "macos"
  }
  if (target.startsWith("windows-")) {
    return "windows"
  }
  return "linux"
}

const artifactPlatform = (kind: SignArtifactKind): SignPlatform =>
  kind === "app" || kind === "dmg" || kind === "zip"
    ? "macos"
    : kind === "msi"
      ? "windows"
      : "linux"

const safeArtifactName = (name: string): string => name.replace(/[^A-Za-z0-9._-]+/g, "-")

const resolvePath = (cwd: string, path: string): string =>
  isAbsolute(path) ? path : resolve(cwd, path)

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")

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
