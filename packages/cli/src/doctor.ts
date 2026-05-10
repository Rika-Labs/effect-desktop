import { access, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { Data, Effect } from "effect"

export class DoctorMissing extends Data.TaggedError("DoctorMissing")<{
  readonly probe: DoctorProbeName
  readonly component: string
  readonly platform: string
  readonly message: string
  readonly remediation: string
  readonly installHint: string
  readonly docsUrl: string
}> {}

export type DoctorProbeName =
  | "bun-version"
  | "rust-toolchain"
  | "platform-sdk"
  | "webview-runtime"
  | "signing-credentials"
  | "build-tools"
  | "package-manager-state"
  | "native-host-cache"
  | "config"

export type DoctorProbeStatus = "ok" | "missing" | "warning"

export interface DoctorCommandInvocation {
  readonly probe: DoctorProbeName
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly platform: string
}

export interface DoctorCommandOutput {
  readonly stdout: string
  readonly stderr: string
}

export type DoctorCommandRunner = (
  invocation: DoctorCommandInvocation
) => Effect.Effect<DoctorCommandOutput, DoctorMissing, never>

export interface DoctorProbeResult {
  readonly name: DoctorProbeName
  readonly status: DoctorProbeStatus
  readonly component: string
  readonly message: string
  readonly remediation: string | undefined
  readonly installHint: string | undefined
  readonly docsUrl: string | undefined
}

export interface DesktopDoctorOptions {
  readonly cwd: string
  readonly configPath: string | undefined
  readonly ci: boolean
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly bunVersion: string
  readonly commandRunner: DoctorCommandRunner
}

export interface DesktopDoctorReport {
  readonly passed: boolean
  readonly ci: boolean
  readonly platform: string
  readonly arch: string
  readonly probes: readonly DoctorProbeResult[]
}

interface AppConfig {
  readonly app?: {
    readonly id?: unknown
    readonly name?: unknown
    readonly version?: unknown
  }
  readonly signing?: {
    readonly macos?: {
      readonly identity?: unknown
      readonly teamId?: unknown
      readonly notarytoolProfile?: unknown
      readonly appleId?: unknown
      readonly passwordEnv?: unknown
    }
    readonly windows?: {
      readonly thumbprint?: unknown
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

const DOCS_URL = "https://github.com/Rika-Labs/effect-desktop/blob/main/docs/SPEC.md"

export const runDesktopDoctor = (
  options: DesktopDoctorOptions
): Effect.Effect<DesktopDoctorReport, never, never> =>
  Effect.gen(function* () {
    const probes = yield* Effect.all(
      [
        probeBunVersion(options),
        probeRustToolchain(options),
        probePlatformSdk(options),
        probeWebviewRuntime(options),
        probeSigningCredentials(options),
        probeBuildTools(options),
        probePackageManagerState(options),
        probeNativeHostCache(options),
        probeConfig(options)
      ],
      { concurrency: 1 }
    )

    return {
      passed: probes.every((probe) => probe.status !== "missing"),
      ci: options.ci,
      platform: options.platform,
      arch: options.arch,
      probes
    }
  })

export const runDoctorCommand: DoctorCommandRunner = (invocation) =>
  Effect.tryPromise({
    try: async () => {
      const child = Bun.spawn([invocation.command, ...invocation.args], {
        cwd: invocation.cwd,
        stdout: "pipe",
        stderr: "pipe"
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        readStreamText(child.stdout),
        readStreamText(child.stderr),
        child.exited
      ])
      if (exitCode !== 0) {
        throw missing({
          probe: invocation.probe,
          component: invocation.command,
          platform: invocation.platform,
          message: `${invocation.command} exited with ${exitCode.toString()}`,
          remediation: remediationForCommand(invocation.command),
          installHint: installHintForCommand(invocation.command),
          docsUrl: DOCS_URL
        })
      }
      return { stdout, stderr }
    },
    catch: (cause) =>
      cause instanceof DoctorMissing
        ? cause
        : missing({
            probe: invocation.probe,
            component: invocation.command,
            platform: invocation.platform,
            message: `${invocation.command} is not available`,
            remediation: remediationForCommand(invocation.command),
            installHint: installHintForCommand(invocation.command),
            docsUrl: DOCS_URL
          })
  })

export const formatDoctorReport = (report: DesktopDoctorReport): string =>
  [
    "Effect Desktop doctor",
    `platform          ${report.platform}-${report.arch}`,
    `ci                ${report.ci ? "yes" : "no"}`,
    `result            ${report.passed ? "ok" : "missing required components"}`,
    ...report.probes.map(formatProbe),
    ""
  ].join("\n")

const probeBunVersion = (
  options: DesktopDoctorOptions
): Effect.Effect<DoctorProbeResult, never, never> =>
  Effect.gen(function* () {
    const floor = yield* readPinnedBunVersion(options.cwd)
    if (compareVersions(options.bunVersion, floor) >= 0) {
      return ok("bun-version", "bun", `Bun ${options.bunVersion} satisfies ${floor}`)
    }
    return missingResult(
      missing({
        probe: "bun-version",
        component: "bun",
        platform: options.platform,
        message: `Bun ${options.bunVersion} is older than required ${floor}`,
        remediation: `Install Bun ${floor} or newer before building.`,
        installHint: "curl -fsSL https://bun.sh/install | bash",
        docsUrl: DOCS_URL
      })
    )
  })

const probeRustToolchain = (
  options: DesktopDoctorOptions
): Effect.Effect<DoctorProbeResult, never, never> =>
  Effect.gen(function* () {
    const cargo = yield* commandProbe(options, "rust-toolchain", "cargo", ["--version"])
    if (cargo.status === "missing") {
      return cargo
    }
    const rustc = yield* commandProbe(options, "rust-toolchain", "rustc", ["--version"])
    if (rustc.status === "missing") {
      return rustc
    }
    return ok("rust-toolchain", "rust", "cargo and rustc are available")
  })

const probePlatformSdk = (
  options: DesktopDoctorOptions
): Effect.Effect<DoctorProbeResult, never, never> => {
  if (options.platform === "darwin") {
    return commandProbe(options, "platform-sdk", "xcode-select", ["-p"])
  }
  if (options.platform === "win32") {
    return commandProbe(options, "platform-sdk", "where", ["cl"])
  }
  if (options.platform === "linux") {
    return commandProbe(options, "platform-sdk", "pkg-config", ["--exists", "webkit2gtk-4.1"])
  }
  return Effect.succeed(
    missingResult(
      missing({
        probe: "platform-sdk",
        component: "platform-sdk",
        platform: options.platform,
        message: `unsupported platform ${options.platform}`,
        remediation: "Use macOS, Windows, or Linux for Effect Desktop builds.",
        installHint: "Run on a supported build host.",
        docsUrl: DOCS_URL
      })
    )
  )
}

const probeWebviewRuntime = (
  options: DesktopDoctorOptions
): Effect.Effect<DoctorProbeResult, never, never> => {
  if (options.platform === "linux") {
    return commandProbe(options, "webview-runtime", "pkg-config", ["--exists", "webkit2gtk-4.1"])
  }
  if (options.platform === "win32") {
    return commandProbe(options, "webview-runtime", "reg", [
      "query",
      "HKLM\\Software\\Microsoft\\EdgeUpdate\\Clients",
      "/s"
    ])
  }
  return Effect.succeed(ok("webview-runtime", "webview", "system WebView runtime is available"))
}

const probeSigningCredentials = (
  options: DesktopDoctorOptions
): Effect.Effect<DoctorProbeResult, never, never> =>
  Effect.gen(function* () {
    const config = yield* readDesktopConfigForDoctor(options)
    const hasCredentials = probeSigningCredentialSupport(config, options.platform)
    if (hasCredentials) {
      return ok("signing-credentials", "signing", "signing credential configuration is present")
    }
    return warning(
      "signing-credentials",
      "signing",
      "signing credentials are not configured; unsigned local packages remain allowed",
      "Set platform signing credentials before release signing.",
      signingHint(options.platform)
    )
  })

const probeBuildTools = (
  options: DesktopDoctorOptions
): Effect.Effect<DoctorProbeResult, never, never> => {
  if (options.platform === "darwin") {
    return commandProbe(options, "build-tools", "hdiutil", ["help"])
  }
  if (options.platform === "win32") {
    return commandProbe(options, "build-tools", "wix", ["--version"])
  }
  return commandProbe(options, "build-tools", "dpkg-deb", ["--version"])
}

const probePackageManagerState = (
  options: DesktopDoctorOptions
): Effect.Effect<DoctorProbeResult, never, never> =>
  Effect.gen(function* () {
    const packageJson = yield* readPackageJson(options.cwd)
    if (packageJson === undefined) {
      return missingResult(
        missing({
          probe: "package-manager-state",
          component: "package.json",
          platform: options.platform,
          message: "package.json is missing or unreadable",
          remediation: "Run doctor from an Effect Desktop workspace root.",
          installHint: "cd <workspace>",
          docsUrl: DOCS_URL
        })
      )
    }
    if (
      typeof packageJson.packageManager === "string" &&
      packageJson.packageManager.startsWith("bun@")
    ) {
      const lockExists = yield* pathExists(join(options.cwd, "bun.lock"))
      if (lockExists) {
        return ok(
          "package-manager-state",
          "bun.lock",
          "Bun package manager and lockfile are present"
        )
      }
      return missingResult(
        missing({
          probe: "package-manager-state",
          component: "bun.lock",
          platform: options.platform,
          message: "bun.lock is missing",
          remediation: "Run `bun install --frozen-lockfile` from the workspace root.",
          installHint: "bun install --frozen-lockfile",
          docsUrl: DOCS_URL
        })
      )
    }
    return missingResult(
      missing({
        probe: "package-manager-state",
        component: "packageManager",
        platform: options.platform,
        message: "package.json#packageManager must be pinned to bun",
        remediation: "Set packageManager to the Bun version pinned by this repository.",
        installHint: "Use the repository package.json packageManager field.",
        docsUrl: DOCS_URL
      })
    )
  })

const probeNativeHostCache = (
  options: DesktopDoctorOptions
): Effect.Effect<DoctorProbeResult, never, never> =>
  Effect.gen(function* () {
    const binary = options.platform === "win32" ? "host.exe" : "host"
    const exists = yield* pathExists(join(options.cwd, "target", "debug", binary))
    if (exists) {
      return ok("native-host-cache", binary, "native host build cache is present")
    }
    return warning(
      "native-host-cache",
      binary,
      "native host build cache is empty",
      "Run `bun desktop build` or `cargo build -p host --release` before packaging.",
      "cargo build -p host --release"
    )
  })

const probeConfig = (
  options: DesktopDoctorOptions
): Effect.Effect<DoctorProbeResult, never, never> =>
  Effect.gen(function* () {
    const configPath = resolve(options.cwd, options.configPath ?? "desktop.config.ts")
    const exists = yield* pathExists(configPath)
    if (!exists) {
      return missingResult(
        missing({
          probe: "config",
          component: "desktop.config.ts",
          platform: options.platform,
          message: `desktop config is missing at ${configPath}`,
          remediation: "Pass --config <path> or create desktop.config.ts.",
          installHint: "desktop doctor --config apps/playground/desktop.config.ts",
          docsUrl: DOCS_URL
        })
      )
    }
    const module = yield* Effect.promise(async () => {
      try {
        return (await import(pathToFileUrl(configPath))) as { readonly default?: unknown }
      } catch {
        return undefined
      }
    })
    if (!isRecord(module?.default)) {
      return missingResult(
        missing({
          probe: "config",
          component: "desktop.config.ts",
          platform: options.platform,
          message: "desktop config must export a default object",
          remediation: "Export an object with app.id, app.name, and app.version.",
          installHint: "export default { app: { id, name, version } }",
          docsUrl: DOCS_URL
        })
      )
    }
    const config = module.default as AppConfig
    if (
      typeof config.app?.id === "string" &&
      typeof config.app.name === "string" &&
      typeof config.app.version === "string"
    ) {
      return ok("config", "desktop.config.ts", "desktop config has required app metadata")
    }
    return missingResult(
      missing({
        probe: "config",
        component: "app metadata",
        platform: options.platform,
        message: "desktop config must define app.id, app.name, and app.version",
        remediation: "Add complete app metadata before build/package.",
        installHint: "app: { id: 'com.example.app', name: 'Example', version: '0.1.0' }",
        docsUrl: DOCS_URL
      })
    )
  })

const commandProbe = (
  options: DesktopDoctorOptions,
  probe: DoctorProbeName,
  command: string,
  args: readonly string[]
): Effect.Effect<DoctorProbeResult, never, never> =>
  options
    .commandRunner({ probe, command, args, cwd: options.cwd, platform: options.platform })
    .pipe(
      Effect.map(() => ok(probe, command, `${command} is available`)),
      Effect.catch((error) => Effect.succeed(missingResult(error)))
    )

const ok = (name: DoctorProbeName, component: string, message: string): DoctorProbeResult => ({
  name,
  status: "ok",
  component,
  message,
  remediation: undefined,
  installHint: undefined,
  docsUrl: undefined
})

const warning = (
  name: DoctorProbeName,
  component: string,
  message: string,
  remediation: string,
  installHint: string
): DoctorProbeResult => ({
  name,
  status: "warning",
  component,
  message,
  remediation,
  installHint,
  docsUrl: DOCS_URL
})

const missingResult = (error: DoctorMissing): DoctorProbeResult => ({
  name: error.probe,
  status: "missing",
  component: error.component,
  message: error.message,
  remediation: error.remediation,
  installHint: error.installHint,
  docsUrl: error.docsUrl
})

const missing = (input: ConstructorParameters<typeof DoctorMissing>[0]): DoctorMissing =>
  new DoctorMissing(input)

const readPinnedBunVersion = (cwd: string): Effect.Effect<string, never, never> =>
  Effect.gen(function* () {
    const packageJson = yield* readPackageJson(cwd)
    if (typeof packageJson?.packageManager === "string") {
      const [, version] = packageJson.packageManager.split("@")
      if (version !== undefined && version.length > 0) {
        return version
      }
    }
    return "1.3.13"
  })

const readPackageJson = (
  cwd: string
): Effect.Effect<{ readonly packageManager?: unknown } | undefined, never, never> =>
  Effect.promise(async () => {
    try {
      return JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
        readonly packageManager?: unknown
      }
    } catch {
      return undefined
    }
  })

const pathExists = (path: string): Effect.Effect<boolean, never, never> =>
  Effect.promise(async () => {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  })

const compareVersions = (actual: string, floor: string): number => {
  const actualParts = parseVersion(actual)
  const floorParts = parseVersion(floor)
  for (const index of [0, 1, 2] as const) {
    const actualPart = actualParts[index] ?? 0
    const floorPart = floorParts[index] ?? 0
    if (actualPart !== floorPart) {
      return actualPart - floorPart
    }
  }
  return 0
}

const parseVersion = (version: string): readonly number[] =>
  version
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isNaN(part) ? 0 : part))

const formatProbe = (probe: DoctorProbeResult): string => {
  const prefix = probe.status === "ok" ? "OK" : probe.status === "warning" ? "WARN" : "MISSING"
  const remediation = probe.remediation === undefined ? [] : [`  next ${probe.remediation}`]
  const installHint = probe.installHint === undefined ? [] : [`  install ${probe.installHint}`]
  return [
    `${prefix.padEnd(8)} ${probe.name} ${probe.message}`,
    ...remediation,
    ...installHint
  ].join("\n")
}

const probeSigningCredentialSupport = (
  config: AppConfig | undefined,
  platform: string
): boolean => {
  if (platform === "darwin") {
    const macos = config?.signing?.macos
    const identity = optionalString(macos?.identity)
    const notarytoolProfile =
      optionalString(macos?.notarytoolProfile) ?? process.env["APPLE_NOTARYTOOL_PROFILE"]
    const teamId = optionalString(macos?.teamId) ?? process.env["APPLE_TEAM_ID"]
    const appleId = optionalString(macos?.appleId) ?? process.env["APPLE_ID"]
    const passwordEnv = optionalString(macos?.passwordEnv) ?? "APPLE_APP_SPECIFIC_PASSWORD"
    const password = process.env[passwordEnv]
    return (
      identity !== undefined &&
      ((notarytoolProfile !== undefined && notarytoolProfile.length > 0) ||
        (teamId !== undefined &&
          appleId !== undefined &&
          password !== undefined &&
          teamId.length > 0 &&
          appleId.length > 0 &&
          password.length > 0))
    )
  }
  if (platform === "win32") {
    const windows = config?.signing?.windows
    if (optionalString(windows?.thumbprint) !== undefined) {
      return true
    }
    const pfxPath = optionalString(windows?.pfx?.path)
    const pfxPasswordEnv = optionalString(windows?.pfx?.passwordEnv)
    if (
      pfxPath !== undefined &&
      pfxPasswordEnv !== undefined &&
      process.env[pfxPasswordEnv] !== undefined
    ) {
      return true
    }
    return process.env["WINDOWS_SIGNING_CERT"] !== undefined
  }
  if (platform === "linux") {
    return (
      optionalString(config?.signing?.linux?.gpgKey) !== undefined ||
      process.env["LINUX_GPG_KEY"] !== undefined
    )
  }
  return false
}

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

const readDesktopConfigForDoctor = (
  options: DesktopDoctorOptions
): Effect.Effect<AppConfig | undefined, never, never> =>
  Effect.gen(function* () {
    const configPath = resolve(options.cwd, options.configPath ?? "desktop.config.ts")
    const module = yield* Effect.tryPromise({
      try: async () =>
        (await import(pathToFileURL(configPath).href)) as {
          readonly default?: unknown
        },
      catch: (cause) => cause
    }).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (module === undefined || !isRecord(module.default)) {
      return undefined
    }
    return module.default as AppConfig
  })

const remediationForCommand = (command: string): string => {
  if (command === "cargo" || command === "rustc") {
    return "Install the Rust toolchain before building the native host."
  }
  if (command === "xcode-select") {
    return "Install Xcode Command Line Tools."
  }
  if (command === "pkg-config") {
    return "Install Linux WebKitGTK and pkg-config dependencies."
  }
  if (command === "wix") {
    return "Install WiX Toolset before producing MSI packages."
  }
  return `Install ${command} before running build/package.`
}

const installHintForCommand = (command: string): string => {
  if (command === "cargo" || command === "rustc") {
    return "rustup toolchain install stable"
  }
  if (command === "xcode-select") {
    return "xcode-select --install"
  }
  if (command === "pkg-config") {
    return "sudo apt-get install -y pkg-config libwebkit2gtk-4.1-dev libssl-dev"
  }
  if (command === "wix") {
    return "dotnet tool install --global wix"
  }
  return `Install ${command} with your platform package manager.`
}

const signingHint = (platform: NodeJS.Platform): string => {
  if (platform === "darwin") {
    return "export APPLE_TEAM_ID=<team-id>"
  }
  if (platform === "win32") {
    return "set WINDOWS_SIGNING_CERT=<certificate>"
  }
  return "export LINUX_GPG_KEY=<key-id>"
}

const pathToFileUrl = (path: string): string => pathToFileURL(path).href

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null

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
