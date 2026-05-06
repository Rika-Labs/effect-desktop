import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { expect, test } from "bun:test"
import { Effect } from "effect"

import { runCli, type CommandRunner } from "./index.js"
import type { PackageCommandRunner } from "./package-pipeline.js"

test("desktop check --production exits non-zero for unacknowledged CSP weakening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-"))
  try {
    await writeFile(
      join(directory, "desktop.config.ts"),
      [
        "export default {",
        "  security: {",
        "    csp: { policy: \"script-src 'self' 'unsafe-inline'\" }",
        "  }",
        "}"
      ].join("\n")
    )

    const stderr: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--production", "--config", "desktop.config.ts"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("weakened-csp")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --production exits zero and reports acknowledged weakenings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-"))
  try {
    await writeFile(
      join(directory, "desktop.config.ts"),
      [
        "export default {",
        "  security: {",
        "    csp: {",
        "      policy: \"script-src 'self' 'unsafe-inline'\",",
        "      acknowledgeWeakening: true,",
        "      justification: 'legacy provider migration'",
        "    }",
        "  }",
        "}"
      ].join("\n")
    )

    const stdout: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--production", "--config", "desktop.config.ts"],
        cwd: directory,
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("ACK weakened-csp")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --production fails when an explicit renderer scan file is unreadable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-"))
  try {
    await writeFile(join(directory, "desktop.config.ts"), "export default {}\n")

    const stderr: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["check", "--production", "--renderer", "missing.ts"],
        cwd: directory,
        writeStdout: () => {},
        writeStderr: (text) => {
          stderr.push(text)
        }
      })
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("missing.ts")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop check --production treats missing renderer path as a usage error", async () => {
  const stderr: string[] = []
  const exitCode = await Effect.runPromise(
    runCli({
      argv: ["check", "--production", "--renderer", "--config", "desktop.config.ts"],
      cwd: process.cwd(),
      writeStdout: () => {},
      writeStderr: (text) => {
        stderr.push(text)
      }
    })
  )

  expect(exitCode).toBe(1)
  expect(stderr.join("")).toContain("--renderer requires a path")
})

test("desktop build stages renderer runtime host bridge manifests and report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-build-"))
  try {
    await writePlaygroundFixture(directory)
    const calls: string[] = []
    const runner: CommandRunner = (invocation) =>
      Effect.gen(function* () {
        calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
        if (invocation.step === "renderer") {
          yield* Effect.promise(() => mkdir(join(invocation.cwd, "dist"), { recursive: true }))
          yield* Effect.promise(() =>
            writeFile(join(invocation.cwd, "dist", "index.html"), "<h1>ok</h1>")
          )
        }
        if (invocation.step === "runtime") {
          const outdir = invocation.args[invocation.args.indexOf("--outdir") + 1]
          if (outdir !== undefined) {
            yield* Effect.promise(() => mkdir(outdir, { recursive: true }))
            yield* Effect.promise(() => writeFile(join(outdir, "main.js"), "console.log('ok')\n"))
          }
        }
        if (invocation.step === "native-host") {
          yield* Effect.promise(() =>
            writeFile(join(invocation.cwd, "target", "debug", "host"), "host")
          )
        }
      })

    const stdout: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["build", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "linux-x64",
        now: fixedClock([100, 125, 200, 260, 300, 305]),
        commandRunner: runner,
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    const layout = join(directory, "apps", "playground", "build", "effect-desktop", "linux-x64")
    const report = JSON.parse(await readFile(join(layout, "build-report.json"), "utf8")) as Record<
      string,
      unknown
    >
    const appManifest = JSON.parse(
      await readFile(join(layout, "app-manifest.json"), "utf8")
    ) as Record<string, unknown>
    const bridgeManifest = JSON.parse(
      await readFile(join(layout, "bridge", "bridge-manifest.json"), "utf8")
    ) as Record<string, unknown>

    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("Effect Desktop build")
    expect(calls).toEqual([
      "renderer:bun run build",
      `runtime:bun build ${join(directory, "apps", "playground", "runtime.ts")} --target=bun --outdir ${join(layout, "runtime")}`,
      "native-host:cargo build -p host"
    ])
    expect(await readFile(join(layout, "renderer", "index.html"), "utf8")).toBe("<h1>ok</h1>")
    expect(await readFile(join(layout, "runtime", "main.js"), "utf8")).toContain("ok")
    expect(await readFile(join(layout, "native", "host"), "utf8")).toBe("host")
    expect(appManifest).toMatchObject({
      id: "dev.effect-desktop.playground",
      name: "Effect Desktop Playground",
      target: "linux-x64"
    })
    expect(bridgeManifest).toMatchObject({
      apiContracts: []
    })
    expect(report).toMatchObject({
      appId: "dev.effect-desktop.playground",
      target: "linux-x64",
      layoutPath: layout
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop build refuses non-matching platform targets with doctor remediation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-build-"))
  try {
    await writePlaygroundFixture(directory)
    const stderr: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: [
          "build",
          "--config",
          "apps/playground/desktop.config.ts",
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
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("BuildUnsupportedTargetError")
    expect(stderr.join("")).toContain("bun desktop doctor")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop package --help exits zero with usage", async () => {
  const stdout: string[] = []
  const exitCode = await Effect.runPromise(
    runCli({
      argv: ["package", "--help"],
      cwd: process.cwd(),
      packageCommandRunner: () => Effect.die("package runner should not run for help"),
      writeStdout: (text) => {
        stdout.push(text)
      },
      writeStderr: () => {}
    })
  )

  expect(exitCode).toBe(0)
  expect(stdout.join("")).toContain("Usage: desktop package")
})

test("desktop package emits macOS app dmg zip artifacts with metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-package-"))
  try {
    await writePlaygroundFixture(directory)
    await writeBuildLayoutFixture(directory, "macos-arm64")
    const outputRoot = join(directory, "apps", "playground", "dist", "desktop", "macos")
    const calls: string[] = []
    const runner: PackageCommandRunner = (invocation) =>
      Effect.gen(function* () {
        calls.push(`${invocation.step}:${invocation.command} ${invocation.args.join(" ")}`)
        const output = invocation.args.at(-1)
        if (output !== undefined) {
          yield* Effect.promise(() => writeFile(output, invocation.step))
        }
      })

    const stdout: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["package", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "macos-arm64",
        now: fixedClock([100, 120, 200, 230, 300, 340]),
        packageCommandRunner: runner,
        writeStdout: (text) => {
          stdout.push(text)
        },
        writeStderr: () => {}
      })
    )

    const appRoot = join(outputRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.app")
    const dmgRoot = join(outputRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.dmg")
    const zipRoot = join(outputRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.zip")
    const appMetadata = JSON.parse(await readFile(join(appRoot, "artifact.json"), "utf8")) as {
      readonly kind: string
      readonly sha256: string
    }

    expect(exitCode).toBe(0)
    expect(stdout.join("")).toContain("Effect Desktop package")
    expect(calls).toEqual([
      `macos-dmg:hdiutil create -srcFolder ${join(appRoot, "Effect-Desktop-Playground.app")} -o ${join(dmgRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.dmg")}`,
      `macos-zip:ditto -c -k --keepParent ${join(appRoot, "Effect-Desktop-Playground.app")} ${join(zipRoot, "Effect-Desktop-Playground-0.0.0-macos-arm64.zip")}`
    ])
    expect(
      await readFile(
        join(appRoot, "Effect-Desktop-Playground.app", "Contents", "Info.plist"),
        "utf8"
      )
    ).toContain("dev.effect-desktop.playground")
    expect(appMetadata.kind).toBe("app")
    expect(appMetadata.sha256).toHaveLength(64)
    expect(await readFile(join(dmgRoot, "checksums.txt"), "utf8")).toContain(".dmg")
    expect(await readFile(join(zipRoot, "checksums.txt"), "utf8")).toContain(".zip")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop package emits Linux AppImage deb rpm artifacts with metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-package-"))
  try {
    await writePlaygroundFixture(directory)
    await writeBuildLayoutFixture(directory, "linux-x64")
    const outputRoot = join(directory, "apps", "playground", "dist", "desktop", "linux")
    const artifactPaths = {
      appimage: join(
        outputRoot,
        "Effect-Desktop-Playground-0.0.0-linux-x64.AppImage",
        "Effect-Desktop-Playground-0.0.0-linux-x64.AppImage"
      ),
      deb: join(
        outputRoot,
        "Effect-Desktop-Playground-0.0.0-linux-x64.deb",
        "Effect-Desktop-Playground-0.0.0-linux-x64.deb"
      ),
      rpm: join(
        outputRoot,
        "Effect-Desktop-Playground-0.0.0-linux-x64.rpm",
        "Effect-Desktop-Playground-0.0.0-linux-x64.rpm"
      )
    } as const
    const calls: string[] = []
    const runner: PackageCommandRunner = (invocation) =>
      Effect.gen(function* () {
        calls.push(`${invocation.step}:${invocation.command}`)
        if (invocation.step === "linux-appimage") {
          yield* Effect.promise(() => writeFile(artifactPaths.appimage, "appimage"))
        }
        if (invocation.step === "linux-deb") {
          yield* Effect.promise(() => writeFile(artifactPaths.deb, "deb"))
        }
        if (invocation.step === "linux-rpm") {
          yield* Effect.promise(() => writeFile(artifactPaths.rpm, "rpm"))
        }
      })

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["package", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "linux-x64",
        packageCommandRunner: runner,
        writeStdout: () => {},
        writeStderr: () => {}
      })
    )

    const debMetadata = JSON.parse(
      await readFile(
        join(outputRoot, "Effect-Desktop-Playground-0.0.0-linux-x64.deb", "artifact.json"),
        "utf8"
      )
    ) as { readonly kind: string; readonly sizeBytes: number }

    expect(exitCode).toBe(0)
    expect(calls).toEqual([
      "linux-appimage:appimagetool",
      "linux-deb:dpkg-deb",
      "linux-rpm:rpmbuild"
    ])
    expect(debMetadata).toMatchObject({ kind: "deb", sizeBytes: 3 })
    expect(
      await readFile(
        join(outputRoot, "Effect-Desktop-Playground-0.0.0-linux-x64.rpm", "checksums.txt"),
        "utf8"
      )
    ).toContain(".rpm")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop package emits Windows per-user MSI with app-specific UpgradeCode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-package-"))
  try {
    await writePlaygroundFixture(directory)
    await writeBuildLayoutFixture(directory, "windows-x64")
    const outputRoot = join(directory, "apps", "playground", "dist", "desktop", "windows")
    const msiPath = join(
      outputRoot,
      "Effect-Desktop-Playground-0.0.0-windows-x64.msi",
      "Effect-Desktop-Playground-0.0.0-windows-x64.msi"
    )
    let wxs = ""
    const runner: PackageCommandRunner = (invocation) =>
      Effect.gen(function* () {
        const wxsPath = invocation.args[1]
        if (typeof wxsPath === "string") {
          wxs = yield* Effect.promise(() => readFile(wxsPath, "utf8"))
        }
        yield* Effect.promise(() => writeFile(msiPath, "msi"))
      })

    const exitCode = await Effect.runPromise(
      runCli({
        argv: ["package", "--config", "apps/playground/desktop.config.ts"],
        cwd: directory,
        hostTarget: "windows-x64",
        packageCommandRunner: runner,
        writeStdout: () => {},
        writeStderr: () => {}
      })
    )

    expect(exitCode).toBe(0)
    expect(wxs).toContain('Scope="perUser"')
    expect(wxs).not.toContain("00000000-0000-0000-0000-000000000064")
    expect(wxs).toMatch(
      /UpgradeCode="[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("desktop package rejects Windows system-mode MSI as deferred scope", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-package-"))
  try {
    await writePlaygroundFixture(directory)
    await writeBuildLayoutFixture(directory, "windows-x64")
    const stderr: string[] = []
    const exitCode = await Effect.runPromise(
      runCli({
        argv: [
          "package",
          "--config",
          "apps/playground/desktop.config.ts",
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
    )

    expect(exitCode).toBe(1)
    expect(stderr.join("")).toContain("PackageUnsupportedArtifactError")
    expect(stderr.join("")).toContain("deferred to v1.1")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const writePlaygroundFixture = async (directory: string): Promise<void> => {
  const appRoot = join(directory, "apps", "playground")
  await mkdir(appRoot, { recursive: true })
  await writeFile(
    join(appRoot, "desktop.config.ts"),
    [
      "export default {",
      "  app: {",
      "    id: 'dev.effect-desktop.playground',",
      "    name: 'Effect Desktop Playground',",
      "    version: '0.0.0'",
      "  },",
      "  runtime: { entry: 'runtime.ts' },",
      "  renderer: { dist: 'dist' }",
      "} as const"
    ].join("\n")
  )
  await writeFile(join(appRoot, "package.json"), '{"type":"module"}\n')
  await writeFile(join(appRoot, "runtime.ts"), "console.log('runtime')\n")
  await mkdir(join(directory, "target", "debug"), { recursive: true })
}

const writeBuildLayoutFixture = async (
  directory: string,
  target: "linux-x64" | "macos-arm64" | "windows-x64"
): Promise<void> => {
  const layout = join(directory, "apps", "playground", "build", "effect-desktop", target)
  const hostBinary = target.startsWith("windows-") ? "host.exe" : "host"
  await mkdir(join(layout, "renderer"), { recursive: true })
  await mkdir(join(layout, "runtime"), { recursive: true })
  await mkdir(join(layout, "native"), { recursive: true })
  await writeFile(join(layout, "renderer", "index.html"), "<h1>ok</h1>")
  await writeFile(join(layout, "runtime", "main.js"), "console.log('runtime')\n")
  await writeFile(join(layout, "native", hostBinary), "host")
  await writeFile(
    join(layout, "app-manifest.json"),
    `${JSON.stringify(
      {
        id: "dev.effect-desktop.playground",
        name: "Effect Desktop Playground",
        version: "0.0.0",
        target,
        renderer: { path: "renderer" },
        runtime: { entry: "runtime/main.js" },
        nativeHost: { binary: `native/${hostBinary}` }
      },
      null,
      2
    )}\n`
  )
}

const fixedClock = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => {
    const value = values[index] ?? values[values.length - 1]
    index += 1
    return value ?? 0
  }
}
