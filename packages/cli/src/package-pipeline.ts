import { createHash } from "node:crypto"
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readlink,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { Data, Effect } from "effect"

export type PackageOs = "linux" | "macos" | "windows"
export type PackageArch = "arm64" | "x64"
export type PackageTarget = `${PackageOs}-${PackageArch}`
export type PackagePlatform = "linux" | "macos" | "windows"
export type PackageArtifactKind = "app" | "dmg" | "zip" | "msi" | "appimage" | "deb" | "rpm"
export type PackageStepName =
  | "macos-app"
  | "macos-dmg"
  | "macos-zip"
  | "windows-msi"
  | "linux-appdir"
  | "linux-appimage"
  | "linux-deb"
  | "linux-rpm"
  | "metadata"

export class PackageConfigError extends Data.TaggedError("PackageConfigError")<{
  readonly field: string
  readonly message: string
}> {}

export class PackageUnsupportedHostError extends Data.TaggedError("PackageUnsupportedHostError")<{
  readonly platform: string
  readonly arch: string
  readonly message: string
  readonly remediation: string
}> {}

export class PackageUnsupportedTargetError extends Data.TaggedError(
  "PackageUnsupportedTargetError"
)<{
  readonly target: string
  readonly hostTarget: PackageTarget
  readonly message: string
  readonly remediation: string
}> {}

export class PackageUnsupportedArtifactError extends Data.TaggedError(
  "PackageUnsupportedArtifactError"
)<{
  readonly artifact: string
  readonly target: PackageTarget
  readonly message: string
  readonly remediation: string
}> {}

export class PackageCommandFailedError extends Data.TaggedError("PackageCommandFailedError")<{
  readonly step: PackageStepName
  readonly command: readonly string[]
  readonly cwd: string
  readonly exitCode: number | undefined
  readonly message: string
  readonly stderr?: string
}> {}

export class PackageMissingBuildArtifactError extends Data.TaggedError(
  "PackageMissingBuildArtifactError"
)<{
  readonly path: string
  readonly message: string
  readonly remediation: string
}> {}

export class PackageFileError extends Data.TaggedError("PackageFileError")<{
  readonly operation: string
  readonly path: string
  readonly message: string
  readonly cause: unknown
}> {}

export type PackagePipelineError =
  | PackageConfigError
  | PackageUnsupportedHostError
  | PackageUnsupportedTargetError
  | PackageUnsupportedArtifactError
  | PackageCommandFailedError
  | PackageMissingBuildArtifactError
  | PackageFileError

export interface PackageCommandInvocation {
  readonly step: PackageStepName
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env?: Readonly<Record<string, string>>
}

export type PackageCommandRunner = (
  invocation: PackageCommandInvocation
) => Effect.Effect<void, PackageCommandFailedError, never>

export interface DesktopPackageOptions {
  readonly cwd: string
  readonly configPath: string
  readonly platform: string | undefined
  readonly artifact: string | undefined
  readonly commandRunner: PackageCommandRunner
  readonly now: () => number
  readonly hostTarget: PackageTarget | undefined
}

export interface PackageArtifactReport {
  readonly kind: PackageArtifactKind
  readonly target: PackageTarget
  readonly artifactPath: string
  readonly artifactJsonPath: string
  readonly checksumsPath: string
  readonly appId: string
  readonly appName: string
  readonly appVersion: string
  readonly sizeBytes: number
  readonly sha256: string
  readonly linuxIntegration?: {
    readonly desktopFile: string
    readonly appStreamId: string
    readonly flatpakAppId: string
    readonly snapName: string
  }
}

export interface PackageStepReport {
  readonly name: PackageStepName
  readonly command?: readonly string[]
  readonly cwd?: string
  readonly elapsedMs: number
  readonly outputPath: string
}

export interface DesktopPackageReport {
  readonly appId: string
  readonly appName: string
  readonly appVersion: string
  readonly target: PackageTarget
  readonly layoutPath: string
  readonly outputPath: string
  readonly artifacts: readonly PackageArtifactReport[]
  readonly steps: readonly PackageStepReport[]
}

interface PackagePlan {
  readonly appId: string
  readonly appName: string
  readonly appVersion: string
  readonly appRoot: string
  readonly layoutPath: string
  readonly outputPath: string
  readonly target: PackageTarget
  readonly platform: PackagePlatform
  readonly artifactKinds: readonly PackageArtifactKind[]
  readonly safeAppName: string
  readonly linuxPackageName: string
}

interface AppConfig {
  readonly app?: {
    readonly id?: unknown
    readonly name?: unknown
    readonly version?: unknown
  }
}

interface AppManifest {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly target: PackageTarget
  readonly renderer: { readonly path: string }
  readonly runtime: { readonly entry: string }
  readonly nativeHost: { readonly binary: string }
}

interface PlannedArtifact {
  readonly kind: PackageArtifactKind
  readonly rootPath: string
  readonly artifactPath: string
}

interface PackageProductionState {
  macosAppStep: PackageStepReport | undefined
}

export const runDesktopPackage = (
  options: DesktopPackageOptions
): Effect.Effect<DesktopPackageReport, PackagePipelineError, never> =>
  Effect.gen(function* () {
    const absoluteConfigPath = resolvePath(options.cwd, options.configPath)
    const rawConfig = yield* loadConfig(absoluteConfigPath)
    const hostTarget = yield* resolveHostTarget(options.hostTarget)
    const target = yield* resolvePackageTarget(options.platform, hostTarget)
    const plan = yield* normalizePackagePlan(rawConfig, {
      configPath: absoluteConfigPath,
      target,
      artifact: options.artifact
    })

    yield* validateBuildLayout(plan)
    yield* makeDirectory(plan.outputPath)

    const steps: PackageStepReport[] = []
    const artifacts: PackageArtifactReport[] = []
    const productionState: PackageProductionState = {
      macosAppStep: undefined
    }

    for (const kind of plan.artifactKinds) {
      const artifact = plannedArtifact(plan, kind)
      yield* removePath(artifact.rootPath)
      const artifactSteps = yield* produceArtifact(options, plan, artifact, productionState)
      steps.push(...artifactSteps)
      const metadata = yield* writeArtifactMetadata(plan, artifact.kind, artifact.artifactPath)
      artifacts.push(metadata)
      steps.push({
        name: "metadata",
        elapsedMs: 0,
        outputPath: artifact.rootPath
      })
    }

    const report: DesktopPackageReport = {
      appId: plan.appId,
      appName: plan.appName,
      appVersion: plan.appVersion,
      target: plan.target,
      layoutPath: plan.layoutPath,
      outputPath: plan.outputPath,
      artifacts,
      steps
    }
    yield* writeJson(join(plan.outputPath, "package-report.json"), report)
    return report
  })

export const detectPackageHostTarget = (): PackageTarget | undefined => {
  const os = process.platform === "darwin" ? "macos" : process.platform
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : undefined
  if ((os === "linux" || os === "macos" || os === "win32") && arch !== undefined) {
    return `${os === "win32" ? "windows" : os}-${arch}` as PackageTarget
  }
  return undefined
}

export const runPackageCommand: PackageCommandRunner = (invocation) =>
  Effect.tryPromise({
    try: async () => {
      const spawned =
        invocation.env === undefined
          ? Bun.spawn([invocation.command, ...invocation.args], {
              cwd: invocation.cwd,
              stdout: "ignore",
              stderr: "pipe"
            })
          : Bun.spawn([invocation.command, ...invocation.args], {
              cwd: invocation.cwd,
              env: { ...globalThis.process.env, ...invocation.env },
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
        throw new PackageCommandFailedError({
          ...(stderr.length === 0 ? failure : { ...failure, stderr })
        })
      }
    },
    catch: (cause) =>
      cause instanceof PackageCommandFailedError
        ? cause
        : new PackageCommandFailedError({
            step: invocation.step,
            command: [invocation.command, ...invocation.args],
            cwd: invocation.cwd,
            exitCode: undefined,
            message: formatUnknownError(cause)
          })
  })

const normalizePackagePlan = (
  rawConfig: unknown,
  options: {
    readonly configPath: string
    readonly target: PackageTarget
    readonly artifact: string | undefined
  }
): Effect.Effect<PackagePlan, PackageConfigError | PackageUnsupportedArtifactError, never> =>
  Effect.gen(function* () {
    const config = yield* readConfigObject(rawConfig)
    const appRoot = dirname(options.configPath)
    const appId = yield* readSafeAppId(config.app?.id, "app.id")
    const appName = yield* readLineSafeString(config.app?.name, "app.name")
    const appVersion = yield* readSemverString(config.app?.version, "app.version")
    const platform = platformFromTarget(options.target)
    const artifactKinds = yield* resolveArtifactKinds(options.artifact, options.target)
    const safeAppName = safeArtifactName(appName)
    if (safeAppName === "." || safeAppName === "..") {
      return yield* Effect.fail(
        new PackageConfigError({
          field: "app.name",
          message: "app.name must not sanitize to . or .."
        })
      )
    }

    return {
      appId,
      appName,
      appVersion,
      appRoot,
      layoutPath: resolvePath(appRoot, join("build", "effect-desktop", options.target)),
      outputPath: resolvePath(appRoot, join("dist", "desktop", platform)),
      target: options.target,
      platform,
      artifactKinds,
      safeAppName,
      linuxPackageName: linuxPackageName(appId, appName)
    }
  })

const validateBuildLayout = (
  plan: PackagePlan
): Effect.Effect<void, PackageFileError | PackageMissingBuildArtifactError, never> =>
  Effect.gen(function* () {
    const manifestPath = join(plan.layoutPath, "app-manifest.json")
    const manifestExists = yield* pathExists(manifestPath)
    if (!manifestExists) {
      return yield* Effect.fail(
        new PackageMissingBuildArtifactError({
          path: manifestPath,
          message: `missing build artifact ${manifestPath}; run desktop build first`,
          remediation: "Run `bun desktop build` with the active config before packaging."
        })
      )
    }
    const rawManifest = yield* readJson<unknown>(manifestPath)
    const manifest = yield* decodeAppManifest(rawManifest, manifestPath)
    if (
      manifest.id !== plan.appId ||
      manifest.name !== plan.appName ||
      manifest.version !== plan.appVersion
    ) {
      return yield* Effect.fail(
        new PackageFileError({
          operation: "validate",
          path: manifestPath,
          message: `app-manifest.json does not match ${plan.appName} ${plan.appId}@${plan.appVersion}`,
          cause: undefined
        })
      )
    }
    if (manifest.target !== plan.target) {
      return yield* Effect.fail(
        new PackageFileError({
          operation: "validate",
          path: manifestPath,
          message: `build manifest target ${manifest.target} does not match package target ${plan.target}`,
          cause: undefined
        })
      )
    }
    yield* statPath(join(plan.layoutPath, manifest.renderer.path))
    yield* statPath(join(plan.layoutPath, manifest.runtime.entry))
    yield* statPath(join(plan.layoutPath, manifest.nativeHost.binary))
  })

const decodeAppManifest = (
  value: unknown,
  path: string
): Effect.Effect<AppManifest, PackageFileError, never> => {
  if (!isRecord(value)) {
    return packageManifestError(path, "app-manifest.json must be an object")
  }
  const id = readManifestString(value, "id", path)
  const name = readManifestString(value, "name", path)
  const version = readManifestString(value, "version", path)
  const target = readManifestTarget(value, path)
  const renderer = readNestedManifestString(value, "renderer", "path", path)
  const runtime = readNestedManifestString(value, "runtime", "entry", path)
  const nativeHost = readNestedManifestString(value, "nativeHost", "binary", path)
  return Effect.all({ id, name, version, target, renderer, runtime, nativeHost }).pipe(
    Effect.map((manifest) => ({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      target: manifest.target,
      renderer: { path: manifest.renderer },
      runtime: { entry: manifest.runtime },
      nativeHost: { binary: manifest.nativeHost }
    }))
  )
}

const readManifestString = (
  record: Readonly<Record<PropertyKey, unknown>>,
  field: string,
  path: string
): Effect.Effect<string, PackageFileError, never> => {
  const value = record[field]
  return typeof value === "string"
    ? Effect.succeed(value)
    : packageManifestError(path, `app-manifest.json field ${field} must be a string`)
}

const readManifestTarget = (
  record: Readonly<Record<PropertyKey, unknown>>,
  path: string
): Effect.Effect<PackageTarget, PackageFileError, never> => {
  const value = record["target"]
  return typeof value === "string" && isPackageTarget(value)
    ? Effect.succeed(value)
    : packageManifestError(path, "app-manifest.json field target must be a package target")
}

const readNestedManifestString = (
  record: Readonly<Record<PropertyKey, unknown>>,
  objectField: string,
  stringField: string,
  path: string
): Effect.Effect<string, PackageFileError, never> => {
  const nested = record[objectField]
  if (!isRecord(nested)) {
    return packageManifestError(path, `app-manifest.json field ${objectField} must be an object`)
  }
  const value = nested[stringField]
  return typeof value === "string"
    ? Effect.succeed(value)
    : packageManifestError(
        path,
        `app-manifest.json field ${objectField}.${stringField} must be a string`
      )
}

const packageManifestError = (
  path: string,
  message: string
): Effect.Effect<never, PackageFileError, never> =>
  Effect.fail(new PackageFileError({ operation: "validate", path, message, cause: undefined }))

const produceArtifact = (
  options: DesktopPackageOptions,
  plan: PackagePlan,
  artifact: PlannedArtifact,
  state: PackageProductionState
): Effect.Effect<
  readonly PackageStepReport[],
  PackageCommandFailedError | PackageFileError,
  never
> => {
  switch (artifact.kind) {
    case "app":
      return Effect.gen(function* () {
        const step = yield* ensureMacosAppBundle(options, plan, state)
        return [step]
      })
    case "dmg":
      return Effect.gen(function* () {
        const hadAppBundle = state.macosAppStep !== undefined
        const appStep = yield* ensureMacosAppBundle(options, plan, state)
        const step = yield* runToolStep(
          options,
          "macos-dmg",
          "hdiutil",
          ["create", "-srcFolder", macosAppBundlePath(plan), "-o", artifact.artifactPath],
          plan.outputPath,
          artifact.artifactPath
        )
        return hadAppBundle ? [step] : [appStep, step]
      })
    case "zip":
      return Effect.gen(function* () {
        const hadAppBundle = state.macosAppStep !== undefined
        const appStep = yield* ensureMacosAppBundle(options, plan, state)
        const step = yield* runToolStep(
          options,
          "macos-zip",
          "ditto",
          ["-c", "-k", "--keepParent", macosAppBundlePath(plan), artifact.artifactPath],
          plan.outputPath,
          artifact.artifactPath
        )
        return hadAppBundle ? [step] : [appStep, step]
      })
    case "msi":
      return Effect.map(produceWindowsMsi(options, plan, artifact), (step) => [step])
    case "appimage":
      return Effect.map(produceLinuxAppImage(options, plan, artifact), (step) => [step])
    case "deb":
      return Effect.map(produceLinuxDeb(options, plan, artifact), (step) => [step])
    case "rpm":
      return Effect.map(produceLinuxRpm(options, plan, artifact), (step) => [step])
  }
}

const ensureMacosAppBundle = (
  options: DesktopPackageOptions,
  plan: PackagePlan,
  state: PackageProductionState
): Effect.Effect<PackageStepReport, PackageFileError, never> =>
  Effect.gen(function* () {
    if (state.macosAppStep !== undefined) {
      return state.macosAppStep
    }
    const step = yield* produceMacosApp(options, plan, plannedArtifact(plan, "app"))
    state.macosAppStep = step
    return step
  })

const produceMacosApp = (
  options: DesktopPackageOptions,
  plan: PackagePlan,
  artifact: PlannedArtifact
): Effect.Effect<PackageStepReport, PackageFileError, never> =>
  Effect.gen(function* () {
    const start = options.now()
    const appBundle = artifact.artifactPath
    const contents = join(appBundle, "Contents")
    const macos = join(contents, "MacOS")
    const resources = join(contents, "Resources", "effect-desktop")
    const executable = join(macos, plan.safeAppName)
    yield* makeDirectory(macos)
    yield* copyDirectory(plan.layoutPath, resources)
    yield* copyFileEffect(join(plan.layoutPath, "native", hostBinaryName(plan.target)), executable)
    yield* chmodEffect(executable, 0o755)
    yield* writeFileEffect(join(contents, "Info.plist"), macosInfoPlist(plan))
    return {
      name: "macos-app",
      elapsedMs: Math.max(0, options.now() - start),
      outputPath: appBundle
    }
  })

const produceWindowsMsi = (
  options: DesktopPackageOptions,
  plan: PackagePlan,
  artifact: PlannedArtifact
): Effect.Effect<PackageStepReport, PackageCommandFailedError | PackageFileError, never> =>
  Effect.gen(function* () {
    const wxsPath = join(artifact.rootPath, `${plan.safeAppName}.wxs`)
    yield* writeFileEffect(wxsPath, windowsWxs(plan))
    return yield* runToolStep(
      options,
      "windows-msi",
      "wix",
      ["build", wxsPath, "-arch", wixArch(plan.target), "-out", artifact.artifactPath],
      plan.appRoot,
      artifact.artifactPath
    )
  })

const produceLinuxAppImage = (
  options: DesktopPackageOptions,
  plan: PackagePlan,
  artifact: PlannedArtifact
): Effect.Effect<PackageStepReport, PackageCommandFailedError | PackageFileError, never> =>
  Effect.gen(function* () {
    const appDir = join(artifact.rootPath, `${plan.safeAppName}.AppDir`)
    yield* stageLinuxAppDir(plan, appDir)
    return yield* runToolStep(
      options,
      "linux-appimage",
      "appimagetool",
      [appDir, artifact.artifactPath],
      plan.appRoot,
      artifact.artifactPath,
      { ARCH: appImageArch(plan.target), VERSION: plan.appVersion }
    )
  })

const produceLinuxDeb = (
  options: DesktopPackageOptions,
  plan: PackagePlan,
  artifact: PlannedArtifact
): Effect.Effect<PackageStepReport, PackageCommandFailedError | PackageFileError, never> =>
  Effect.gen(function* () {
    const debRoot = join(artifact.rootPath, "deb-root")
    yield* stageDebRoot(plan, debRoot)
    return yield* runToolStep(
      options,
      "linux-deb",
      "dpkg-deb",
      ["--build", debRoot, artifact.artifactPath],
      plan.appRoot,
      artifact.artifactPath
    )
  })

const produceLinuxRpm = (
  options: DesktopPackageOptions,
  plan: PackagePlan,
  artifact: PlannedArtifact
): Effect.Effect<PackageStepReport, PackageCommandFailedError | PackageFileError, never> =>
  Effect.gen(function* () {
    const rpmRoot = join(artifact.rootPath, "rpm-root")
    const specPath = join(rpmRoot, "SPECS", `${plan.safeAppName}.spec`)
    yield* stageRpmRoot(plan, rpmRoot)
    yield* writeFileEffect(specPath, rpmSpec(plan))
    return yield* runToolStep(
      options,
      "linux-rpm",
      "rpmbuild",
      [
        "-bb",
        specPath,
        "--define",
        `_topdir ${rpmRoot}`,
        "--define",
        `_rpmdir ${dirname(artifact.artifactPath)}`,
        "--define",
        `_rpmfilename ${basename(artifact.artifactPath)}`
      ],
      plan.appRoot,
      artifact.artifactPath
    )
  })

const runToolStep = (
  options: DesktopPackageOptions,
  name: Exclude<PackageStepName, "macos-app" | "metadata" | "linux-appdir">,
  command: string,
  args: readonly string[],
  cwd: string,
  outputPath: string,
  env?: Readonly<Record<string, string>>
): Effect.Effect<PackageStepReport, PackageCommandFailedError | PackageFileError, never> =>
  Effect.gen(function* () {
    const start = options.now()
    yield* makeDirectory(dirname(outputPath))
    yield* options.commandRunner(
      env === undefined
        ? { step: name, command, args, cwd }
        : { step: name, command, args, cwd, env }
    )
    yield* statPath(outputPath)
    return {
      name,
      command: [command, ...args],
      cwd,
      elapsedMs: Math.max(0, options.now() - start),
      outputPath
    }
  })

const writeArtifactMetadata = (
  plan: PackagePlan,
  kind: PackageArtifactKind,
  artifactPath: string
): Effect.Effect<PackageArtifactReport, PackageFileError, never> =>
  Effect.gen(function* () {
    const rootPath = dirname(artifactPath)
    const digest = yield* digestPath(artifactPath)
    const artifactJsonPath = join(rootPath, "artifact.json")
    const checksumsPath = join(rootPath, "checksums.txt")
    const metadata = {
      appId: plan.appId,
      appName: plan.appName,
      appVersion: plan.appVersion,
      kind,
      target: plan.target,
      fileName: basename(artifactPath),
      sizeBytes: digest.sizeBytes,
      sha256: digest.sha256,
      ...(plan.platform === "linux"
        ? {
            linuxIntegration: {
              desktopFile: `${plan.linuxPackageName}.desktop`,
              appStreamId: `${plan.appId}.metainfo.xml`,
              flatpakAppId: plan.appId,
              snapName: plan.linuxPackageName
            }
          }
        : {})
    }
    yield* writeJson(artifactJsonPath, metadata)
    yield* writeFileEffect(checksumsPath, `${digest.sha256}  ${basename(artifactPath)}\n`)
    return {
      kind,
      target: plan.target,
      artifactPath,
      artifactJsonPath,
      checksumsPath,
      appId: plan.appId,
      appName: plan.appName,
      appVersion: plan.appVersion,
      sizeBytes: digest.sizeBytes,
      sha256: digest.sha256
    }
  })

const plannedArtifact = (plan: PackagePlan, kind: PackageArtifactKind): PlannedArtifact => {
  const extension = artifactExtension(kind)
  const name = `${plan.safeAppName}-${plan.appVersion}-${plan.target}.${extension}`
  const rootPath = join(plan.outputPath, name)
  return {
    kind,
    rootPath,
    artifactPath: join(rootPath, kind === "app" ? `${plan.safeAppName}.app` : name)
  }
}

const resolveArtifactKinds = (
  requested: string | undefined,
  target: PackageTarget
): Effect.Effect<readonly PackageArtifactKind[], PackageUnsupportedArtifactError, never> => {
  const platformKinds = artifactKindsForTarget(target)
  if (requested === undefined || requested === "all") {
    return Effect.succeed(platformKinds)
  }
  if (requested === "windows-system-msi" || requested === "system-msi") {
    return Effect.fail(
      new PackageUnsupportedArtifactError({
        artifact: requested,
        target,
        message: "Windows system-mode MSI is deferred to v1.1",
        remediation: "Add an ADR before introducing system-mode installer support."
      })
    )
  }
  if (isPackageArtifactKind(requested) && platformKinds.includes(requested)) {
    return Effect.succeed([requested])
  }
  return Effect.fail(
    new PackageUnsupportedArtifactError({
      artifact: requested,
      target,
      message: `artifact ${requested} is not part of the ${target} package set`,
      remediation: "Use the default artifact set from docs/SPEC.md §23.2."
    })
  )
}

const artifactKindsForTarget = (target: PackageTarget): readonly PackageArtifactKind[] => {
  if (target.startsWith("macos-")) {
    return ["app", "dmg", "zip"]
  }
  if (target.startsWith("windows-")) {
    return ["msi"]
  }
  return ["appimage", "deb", "rpm"]
}

const isPackageArtifactKind = (value: string): value is PackageArtifactKind =>
  value === "app" ||
  value === "dmg" ||
  value === "zip" ||
  value === "msi" ||
  value === "appimage" ||
  value === "deb" ||
  value === "rpm"

const resolvePackageTarget = (
  requested: string | undefined,
  hostTarget: PackageTarget
): Effect.Effect<PackageTarget, PackageUnsupportedTargetError, never> => {
  const target = requested ?? hostTarget
  if (!isPackageTarget(target)) {
    return Effect.fail(
      new PackageUnsupportedTargetError({
        target,
        hostTarget,
        message: `unsupported package target ${target}`,
        remediation:
          "Run `bun desktop doctor` on a supported host and choose the matching --platform."
      })
    )
  }
  if (target !== hostTarget) {
    return Effect.fail(
      new PackageUnsupportedTargetError({
        target,
        hostTarget,
        message: `target ${target} does not match host ${hostTarget}`,
        remediation:
          "Cross-platform package artifacts are out of scope. Package on the matching host."
      })
    )
  }
  return Effect.succeed(target)
}

const resolveHostTarget = (
  override: PackageTarget | undefined
): Effect.Effect<PackageTarget, PackageUnsupportedHostError, never> => {
  const hostTarget = override ?? detectPackageHostTarget()
  if (hostTarget !== undefined) {
    return Effect.succeed(hostTarget)
  }
  return Effect.fail(
    new PackageUnsupportedHostError({
      platform: process.platform,
      arch: process.arch,
      message: `unsupported host ${process.platform}-${process.arch}`,
      remediation: "Run `bun desktop doctor` on linux, macOS, or Windows with x64 or arm64."
    })
  )
}

const isPackageTarget = (value: string): value is PackageTarget =>
  value === "linux-x64" ||
  value === "linux-arm64" ||
  value === "macos-x64" ||
  value === "macos-arm64" ||
  value === "windows-x64" ||
  value === "windows-arm64"

const platformFromTarget = (target: PackageTarget): PackagePlatform => {
  if (target.startsWith("macos-")) {
    return "macos"
  }
  if (target.startsWith("windows-")) {
    return "windows"
  }
  return "linux"
}

const artifactExtension = (kind: PackageArtifactKind): string =>
  kind === "appimage" ? "AppImage" : kind

const safeArtifactName = (name: string): string => name.replace(/[^A-Za-z0-9._-]+/g, "-")

const linuxPackageName = (appId: string, appName: string): string => {
  const source = appId.length > 0 ? appId : appName
  return source.toLowerCase().replace(/[^a-z0-9+.-]+/g, "-")
}

const macosAppBundlePath = (plan: PackagePlan): string => plannedArtifact(plan, "app").artifactPath

const hostBinaryName = (target: PackageTarget): string =>
  target.startsWith("windows-") ? "host.exe" : "host"

const wixArch = (target: PackageTarget): string => (target.endsWith("-arm64") ? "arm64" : "x64")

const appImageArch = (target: PackageTarget): string =>
  target.endsWith("-arm64") ? "aarch64" : "x86_64"

const packageArch = (target: PackageTarget): string =>
  target.endsWith("-arm64") ? "arm64" : "amd64"

const rpmArch = (target: PackageTarget): string =>
  target.endsWith("-arm64") ? "aarch64" : "x86_64"

const appUpgradeCode = (appId: string): string => {
  const bytes = createHash("sha256").update(`effect-desktop:msi-upgrade:${appId}`).digest()
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = bytes.subarray(0, 16).toString("hex")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join("-")
}

const appShortcutComponentGuid = (appId: string): string => {
  const bytes = createHash("sha256").update(`effect-desktop:msi-shortcut:${appId}`).digest()
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = bytes.subarray(0, 16).toString("hex")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join("-")
}

const macosInfoPlist = (plan: PackagePlan): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${escapeXml(plan.safeAppName)}</string>
  <key>CFBundleIdentifier</key>
  <string>${escapeXml(plan.appId)}</string>
  <key>CFBundleName</key>
  <string>${escapeXml(plan.appName)}</string>
  <key>CFBundleShortVersionString</key>
  <string>${escapeXml(plan.appVersion)}</string>
  <key>CFBundleVersion</key>
  <string>${escapeXml(plan.appVersion)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
</dict>
</plist>
`

const windowsWxs = (
  plan: PackagePlan
): string => `<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Package Name="${escapeXml(plan.appName)}" Manufacturer="Effect Desktop" Version="${escapeXml(plan.appVersion)}" UpgradeCode="${appUpgradeCode(plan.appId)}" Scope="perUser">
    <MajorUpgrade DowngradeErrorMessage="A newer version is already installed." />
    <Feature Id="Main">
      <ComponentGroupRef Id="ApplicationFiles" />
      <ComponentGroupRef Id="StartMenuShortcuts" />
    </Feature>
    <StandardDirectory Id="LocalAppDataFolder">
      <Directory Id="INSTALLFOLDER" Name="${escapeXml(plan.safeAppName)}" />
    </StandardDirectory>
    <StandardDirectory Id="ProgramMenuFolder">
      <Directory Id="ApplicationProgramsFolder" Name="${escapeXml(plan.appName)}" />
    </StandardDirectory>
  </Package>
  <Fragment>
    <ComponentGroup Id="ApplicationFiles" Directory="INSTALLFOLDER">
      <Files Include="${escapeXml(plan.layoutPath)}\\**" />
    </ComponentGroup>
    <ComponentGroup Id="StartMenuShortcuts" Directory="ApplicationProgramsFolder">
      <Component Id="StartMenuShortcut" Guid="${appShortcutComponentGuid(plan.appId)}">
        <Shortcut Id="ApplicationStartMenuShortcut" Name="${escapeXml(plan.appName)}" Description="${escapeXml(plan.appName)}" Target="[INSTALLFOLDER]native\\host.exe" WorkingDirectory="INSTALLFOLDER" />
        <RemoveFolder Id="RemoveApplicationProgramsFolder" Directory="ApplicationProgramsFolder" On="uninstall" />
        <RegistryValue Root="HKCU" Key="Software\\EffectDesktop\\${escapeXml(plan.safeAppName)}" Name="installed" Type="integer" Value="1" KeyPath="yes" />
      </Component>
    </ComponentGroup>
  </Fragment>
</Wix>
`

const stageLinuxAppDir = (
  plan: PackagePlan,
  appDir: string
): Effect.Effect<void, PackageFileError, never> =>
  Effect.gen(function* () {
    const binDir = join(appDir, "usr", "bin")
    const shareDir = join(appDir, "usr", "share", plan.linuxPackageName)
    yield* copyDirectory(plan.layoutPath, shareDir)
    yield* makeDirectory(binDir)
    yield* writeFileEffect(
      join(appDir, "AppRun"),
      `#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/share/${plan.linuxPackageName}/native/${hostBinaryName(plan.target)}" "$@"
`
    )
    yield* chmodEffect(join(appDir, "AppRun"), 0o755)
    yield* stageLinuxLauncherMetadata(plan, appDir)
    yield* writeFileEffect(
      join(appDir, `${plan.linuxPackageName}.desktop`),
      linuxDesktopEntry(plan)
    )
  })

const stageDebRoot = (
  plan: PackagePlan,
  root: string
): Effect.Effect<void, PackageFileError, never> =>
  Effect.gen(function* () {
    yield* copyDirectory(plan.layoutPath, join(root, "usr", "lib", plan.linuxPackageName))
    yield* stageLinuxLauncherMetadata(plan, join(root, "usr"))
    yield* makeDirectory(join(root, "DEBIAN"))
    yield* writeFileEffect(
      join(root, "DEBIAN", "control"),
      [
        `Package: ${plan.linuxPackageName}`,
        `Version: ${plan.appVersion}`,
        "Section: utils",
        "Priority: optional",
        `Architecture: ${packageArch(plan.target)}`,
        "Maintainer: Effect Desktop <maintainers@example.invalid>",
        `Description: ${plan.appName}`,
        ""
      ].join("\n")
    )
  })

const stageRpmRoot = (
  plan: PackagePlan,
  root: string
): Effect.Effect<void, PackageFileError, never> =>
  Effect.gen(function* () {
    yield* makeDirectory(join(root, "SPECS"))
    yield* copyDirectory(
      plan.layoutPath,
      join(root, "BUILDROOT", plan.linuxPackageName, "usr", "lib", plan.linuxPackageName)
    )
    yield* stageLinuxLauncherMetadata(plan, join(root, "BUILDROOT", plan.linuxPackageName, "usr"))
  })

const rpmSpec = (plan: PackagePlan): string => {
  return [
    `Name: ${plan.linuxPackageName}`,
    `Version: ${plan.appVersion}`,
    "Release: 1",
    "Summary: Effect Desktop application",
    "License: Proprietary",
    `BuildArch: ${rpmArch(plan.target)}`,
    "",
    "%description",
    plan.appName,
    "",
    "%files",
    `/usr/lib/${plan.linuxPackageName}`,
    `/usr/share/applications/${plan.linuxPackageName}.desktop`,
    `/usr/share/metainfo/${plan.appId}.metainfo.xml`,
    `/usr/share/flatpak/${plan.appId}.json`,
    "/usr/share/snap/snapcraft.yaml",
    ""
  ].join("\n")
}

const stageLinuxLauncherMetadata = (
  plan: PackagePlan,
  root: string
): Effect.Effect<void, PackageFileError, never> =>
  Effect.gen(function* () {
    yield* writeFileEffect(
      join(root, "share", "applications", `${plan.linuxPackageName}.desktop`),
      linuxDesktopEntry(plan)
    )
    yield* writeFileEffect(
      join(root, "share", "metainfo", `${plan.appId}.metainfo.xml`),
      linuxAppstreamMetainfo(plan)
    )
    yield* writeFileEffect(
      join(root, "share", "flatpak", `${plan.appId}.json`),
      linuxFlatpakHint(plan)
    )
    yield* writeFileEffect(join(root, "share", "snap", "snapcraft.yaml"), linuxSnapHint(plan))
  })

const linuxDesktopEntry = (plan: PackagePlan): string =>
  [
    "[Desktop Entry]",
    `Name=${plan.appName}`,
    `Exec=${plan.linuxPackageName}`,
    `Icon=${plan.appId}`,
    "Type=Application",
    "Categories=Utility;",
    `X-Flatpak=${plan.appId}`,
    `X-SnapInstanceName=${plan.linuxPackageName}`,
    ""
  ].join("\n")

const linuxAppstreamMetainfo = (
  plan: PackagePlan
): string => `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${escapeXml(plan.appId)}</id>
  <name>${escapeXml(plan.appName)}</name>
  <summary>${escapeXml(plan.appName)}</summary>
  <launchable type="desktop-id">${escapeXml(plan.linuxPackageName)}.desktop</launchable>
  <releases>
    <release version="${escapeXml(plan.appVersion)}" />
  </releases>
</component>
`

const linuxFlatpakHint = (plan: PackagePlan): string =>
  `${JSON.stringify(
    {
      appId: plan.appId,
      command: plan.linuxPackageName,
      desktopFile: `${plan.linuxPackageName}.desktop`,
      metainfo: `${plan.appId}.metainfo.xml`
    },
    null,
    2
  )}\n`

const linuxSnapHint = (plan: PackagePlan): string =>
  [
    `name: ${plan.linuxPackageName}`,
    `version: ${plan.appVersion}`,
    `title: ${plan.appName}`,
    "apps:",
    `  ${plan.linuxPackageName}:`,
    `    command: usr/lib/${plan.linuxPackageName}/native/${hostBinaryName(plan.target)}`,
    `    desktop: usr/share/applications/${plan.linuxPackageName}.desktop`,
    ""
  ].join("\n")

const readConfigObject = (
  rawConfig: unknown
): Effect.Effect<AppConfig, PackageConfigError, never> =>
  isRecord(rawConfig)
    ? Effect.succeed(rawConfig as AppConfig)
    : Effect.fail(
        new PackageConfigError({
          field: "default",
          message: "desktop config must export an object"
        })
      )

const readRequiredString = (
  value: unknown,
  field: string
): Effect.Effect<string, PackageConfigError, never> => {
  if (typeof value === "string" && value.length > 0) {
    return Effect.succeed(value)
  }
  return Effect.fail(new PackageConfigError({ field, message: `${field} is required` }))
}

const readLineSafeString = (
  value: unknown,
  field: string
): Effect.Effect<string, PackageConfigError, never> =>
  readRequiredString(value, field).pipe(
    Effect.flatMap((text) =>
      isLineSafeText(text)
        ? Effect.succeed(text)
        : Effect.fail(
            new PackageConfigError({
              field,
              message: `${field} must not contain control characters`
            })
          )
    )
  )

const isLineSafeText = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) {
      return false
    }
  }
  return true
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
): Effect.Effect<string, PackageConfigError, never> =>
  readRequiredString(value, field).pipe(
    Effect.flatMap((appId) =>
      appIdMatch(appId)
        ? Effect.succeed(appId)
        : Effect.fail(
            new PackageConfigError({
              field,
              message: `${field} must be a reverse-DNS ASCII identifier`
            })
          )
    )
  )

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u

const readSemverString = (
  value: unknown,
  field: string
): Effect.Effect<string, PackageConfigError, never> =>
  readRequiredString(value, field).pipe(
    Effect.flatMap((version) =>
      SEMVER_PATTERN.test(version)
        ? Effect.succeed(version)
        : Effect.fail(
            new PackageConfigError({ field, message: `${field} must be a SemVer X.Y.Z string` })
          )
    )
  )

const loadConfig = (path: string): Effect.Effect<unknown, PackageConfigError, never> =>
  Effect.gen(function* () {
    const module = yield* Effect.tryPromise({
      try: async () => (await import(pathToFileURL(path).href)) as { readonly default?: unknown },
      catch: (cause) =>
        new PackageConfigError({
          field: "default",
          message: `failed to load config ${path}: ${formatUnknownError(cause)}`
        })
    })
    if (!isRecord(module.default)) {
      return yield* Effect.fail(
        new PackageConfigError({
          field: "default",
          message: `config ${path} must export a default object`
        })
      )
    }
    return module.default
  })

const readJson = <A>(path: string): Effect.Effect<A, PackageFileError, never> =>
  Effect.tryPromise({
    try: async () => JSON.parse(await readFile(path, "utf8")) as A,
    catch: (cause) =>
      new PackageFileError({
        operation: "read-json",
        path,
        message: `failed to read JSON ${path}`,
        cause
      })
  })

const digestPath = (
  path: string
): Effect.Effect<
  { readonly sizeBytes: number; readonly sha256: string },
  PackageFileError,
  never
> =>
  Effect.gen(function* () {
    const pathStat = yield* statPath(path)
    if (!pathStat.isDirectory()) {
      const content = yield* readFileEffect(path)
      return {
        sizeBytes: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex")
      }
    }

    const files = yield* listFiles(path)
    const hash = createHash("sha256")
    let sizeBytes = 0
    for (const file of files.toSorted((a, b) => a.relativePath.localeCompare(b.relativePath))) {
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
      const content = yield* readFileEffect(file.absolutePath)
      sizeBytes += content.byteLength
      hash.update(content)
      hash.update("\0")
    }
    return { sizeBytes, sha256: hash.digest("hex") }
  })

type DirectoryEntryKind = "directory" | "file" | "symlink"

interface DirectoryEntry {
  readonly absolutePath: string
  readonly kind: DirectoryEntryKind
  readonly relativePath: string
  readonly mode: number
  readonly target: string
}

const listFiles = (
  path: string
): Effect.Effect<readonly DirectoryEntry[], PackageFileError, never> =>
  Effect.gen(function* () {
    const files = yield* walkDirectoryEntries(path, path)
    return files
  })

const walkDirectoryEntries = (
  rootPath: string,
  currentPath: string
): Effect.Effect<readonly DirectoryEntry[], PackageFileError, never> =>
  Effect.gen(function* () {
    const entries = yield* readDirectory(currentPath)
    const files: DirectoryEntry[] = []
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
        files.push(...(yield* walkDirectoryEntries(rootPath, childPath)))
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

const copyDirectory = (
  source: string,
  destination: string
): Effect.Effect<void, PackageFileError, never> =>
  copyContainedDirectory(source, destination, source)

const copyContainedDirectory = (
  root: string,
  destination: string,
  source: string
): Effect.Effect<void, PackageFileError, never> =>
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

const writeJson = (path: string, value: unknown): Effect.Effect<void, PackageFileError, never> =>
  writeFileEffect(path, `${JSON.stringify(value, null, 2)}\n`)

const writeFileEffect = (
  path: string,
  content: string
): Effect.Effect<void, PackageFileError, never> =>
  Effect.gen(function* () {
    yield* makeDirectory(dirname(path))
    yield* Effect.tryPromise({
      try: () => writeFile(path, content),
      catch: (cause) =>
        new PackageFileError({
          operation: "write",
          path,
          message: `failed to write ${path}`,
          cause
        })
    })
  })

const readFileEffect = (path: string): Effect.Effect<Uint8Array, PackageFileError, never> =>
  Effect.tryPromise({
    try: () => readFile(path),
    catch: (cause) =>
      new PackageFileError({
        operation: "read",
        path,
        message: `failed to read ${path}`,
        cause
      })
  })

const makeDirectory = (path: string): Effect.Effect<void, PackageFileError, never> =>
  Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }),
    catch: (cause) =>
      new PackageFileError({
        operation: "mkdir",
        path,
        message: `failed to create ${path}`,
        cause
      })
  }).pipe(Effect.asVoid)

const removePath = (path: string): Effect.Effect<void, PackageFileError, never> =>
  Effect.tryPromise({
    try: () => rm(path, { recursive: true, force: true }),
    catch: (cause) =>
      new PackageFileError({
        operation: "rm",
        path,
        message: `failed to remove ${path}`,
        cause
      })
  })

const readDirectory = (path: string): Effect.Effect<readonly string[], PackageFileError, never> =>
  Effect.tryPromise({
    try: () => readdir(path),
    catch: (cause) =>
      new PackageFileError({
        operation: "readdir",
        path,
        message: `failed to read ${path}`,
        cause
      })
  })

const statPath = (
  path: string
): Effect.Effect<Awaited<ReturnType<typeof stat>>, PackageFileError, never> =>
  Effect.tryPromise({
    try: () => stat(path),
    catch: (cause) =>
      new PackageFileError({
        operation: "stat",
        path,
        message: `failed to stat ${path}`,
        cause
      })
  })

const pathExists = (path: string): Effect.Effect<boolean, never, never> =>
  Effect.promise(async () => {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  })

const lstatPath = (
  path: string
): Effect.Effect<Awaited<ReturnType<typeof lstat>>, PackageFileError, never> =>
  Effect.tryPromise({
    try: () => lstat(path),
    catch: (cause) =>
      new PackageFileError({
        operation: "lstat",
        path,
        message: `failed to lstat ${path}`,
        cause
      })
  })

const readlinkPath = (path: string): Effect.Effect<string, PackageFileError, never> =>
  Effect.tryPromise({
    try: () => readlink(path),
    catch: (cause) =>
      new PackageFileError({
        operation: "readlink",
        path,
        message: `failed to readlink ${path}`,
        cause
      })
  })

const resolveContainedSymlink = (
  root: string,
  symlinkPath: string
): Effect.Effect<string, PackageFileError, never> =>
  Effect.gen(function* () {
    const target = yield* readlinkPath(symlinkPath)
    const resolvedTarget = resolve(dirname(symlinkPath), target)
    if (isPathInside(root, resolvedTarget)) {
      return resolvedTarget
    }
    return yield* Effect.fail(
      new PackageFileError({
        operation: "copy",
        path: symlinkPath,
        message: `symlink ${symlinkPath} points outside ${root}`,
        cause: target
      })
    )
  })

const isPathInside = (root: string, path: string): boolean => {
  const relativePath = relative(root, path)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

const copyFileEffect = (
  source: string,
  destination: string
): Effect.Effect<void, PackageFileError, never> =>
  Effect.gen(function* () {
    yield* makeDirectory(dirname(destination))
    yield* Effect.tryPromise({
      try: () => copyFile(source, destination),
      catch: (cause) =>
        new PackageFileError({
          operation: "copy",
          path: source,
          message: `failed to copy ${source} to ${destination}`,
          cause
        })
    })
  })

const chmodEffect = (path: string, mode: number): Effect.Effect<void, PackageFileError, never> =>
  Effect.tryPromise({
    try: () => chmod(path, mode),
    catch: (cause) =>
      new PackageFileError({
        operation: "chmod",
        path,
        message: `failed to chmod ${path}`,
        cause
      })
  })

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
