import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "bun:test"
import { Effect } from "effect"

import { rewritePackageJsonWorkspaceDependencies } from "../packages/cli/src/pack-installable-cli.js"

test("pack-installable-cli rejects malformed dependency maps before rewriting", async () => {
  let failure = ""
  try {
    await Effect.runPromise(
      rewritePackageJsonWorkspaceDependencies(
        {
          name: "@orika/fixture",
          dependencies: {
            "@orika/core": 42
          }
        },
        "package.json"
      )
    )
  } catch (error) {
    failure = String(error)
  }

  expect(failure).toContain("failed to parse package.json#dependencies")
})

test("pack-installable-cli rewrites only local workspace dependencies", async () => {
  const rewritten = await Effect.runPromise(
    rewritePackageJsonWorkspaceDependencies({
      name: "@orika/fixture",
      version: "1.0.0",
      devDependencies: {
        "@orika/core": "workspace:*"
      },
      dependencies: {
        "@orika/core": "workspace:*",
        "left-pad": "^1.3.0"
      }
    })
  )

  expect(rewritten["name"]).toBe("@orika/fixture")
  expect(rewritten["version"]).toBe("1.0.0")
  expect(rewritten["devDependencies"]).toEqual({
    "@orika/core": "workspace:*"
  })
  expect(rewritten["dependencies"]).toEqual({
    "@orika/core": "file:../core",
    "left-pad": "^1.3.0"
  })
})

const repoRoot = join(import.meta.dir, "..")

test("pack-installable-cli emits a workspace-free CLI package installable by a temp app", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-artifact-"))
  try {
    const sourceMatrix = await readFile(
      join(repoRoot, "packages", "cli", "src", "native-parity-matrix.json"),
      "utf8"
    )
    const sourceSummary = nativeParitySummary(sourceMatrix)
    const artifactRoot = join(directory, "artifact")
    const pack = Bun.spawn(
      ["bun", join(repoRoot, "scripts", "pack-installable-cli.ts"), artifactRoot],
      {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe"
      }
    )
    const [packStdout, packStderr, packExitCode] = await Promise.all([
      new Response(pack.stdout).text(),
      new Response(pack.stderr).text(),
      pack.exited
    ])
    expect(packExitCode, packStdout + packStderr).toBe(0)

    const packedManifest = await readFile(
      join(artifactRoot, "packages", "cli", "package.json"),
      "utf8"
    )
    expect(packedManifest).not.toContain("workspace:*")
    expect(packedManifest).toContain('"@orika/bridge": "file:../bridge"')
    expect(packedManifest).toContain('"@orika/config": "file:../config"')
    expect(packedManifest).toContain('"@orika/core": "file:../core"')

    const appRoot = join(directory, "app")
    await mkdir(appRoot)
    await writeFile(
      join(appRoot, "package.json"),
      JSON.stringify({
        type: "module",
        packageManager: "bun@1.3.13",
        dependencies: {
          "@orika/cli": `file:${join(artifactRoot, "packages", "cli")}`
        }
      })
    )
    await writeFile(
      join(appRoot, "desktop.config.ts"),
      "export default { app: { id: 'dev.effect-desktop.pack-test', name: 'Pack Test', version: '0.0.0' } } as const\n"
    )

    const install = Bun.spawn(["bun", "install"], {
      cwd: appRoot,
      stdout: "pipe",
      stderr: "pipe"
    })
    const [installStdout, installStderr, installExitCode] = await Promise.all([
      new Response(install.stdout).text(),
      new Response(install.stderr).text(),
      install.exited
    ])
    expect(installExitCode, installStdout + installStderr).toBe(0)

    const help = Bun.spawn(["bunx", "desktop"], {
      cwd: appRoot,
      stdout: "pipe",
      stderr: "pipe"
    })
    const [helpStdout, helpStderr, helpExitCode] = await Promise.all([
      new Response(help.stdout).text(),
      new Response(help.stderr).text(),
      help.exited
    ])
    const helpText = helpStdout + helpStderr
    expect(helpExitCode).toBe(1)
    expect(helpText).toContain("USAGE\n  desktop <subcommand> [flags]")
    expect(helpText).toContain(
      "build       Build renderer, runtime, native host, bridge manifest, and app manifest"
    )

    const installedMatrix = await readFile(
      join(appRoot, "node_modules", "@orika", "cli", "src", "native-parity-matrix.json"),
      "utf8"
    )
    expect(nativeParitySummary(installedMatrix)).toEqual(sourceSummary)

    const doctor = Bun.spawn(["bunx", "desktop", "doctor", "--json"], {
      cwd: appRoot,
      stdout: "pipe",
      stderr: "pipe"
    })
    const [doctorStdout, doctorStderr, doctorExitCode] = await Promise.all([
      new Response(doctor.stdout).text(),
      new Response(doctor.stderr).text(),
      doctor.exited
    ])
    const doctorText = doctorStdout + doctorStderr
    expect([0, 1]).toContain(doctorExitCode)
    expect(doctorText).toContain('"name": "native-capabilities"')
    expect(doctorText).toContain(
      `native capability matrix reports ${sourceSummary.total} methods, ${sourceSummary.routed} host-routed, ${sourceSummary.missing} missing host routes`
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 180_000)

interface NativeParitySummary {
  readonly total: number
  readonly routed: number
  readonly missing: number
}

const nativeParitySummary = (content: string): NativeParitySummary => {
  const parsed: unknown = JSON.parse(content)
  if (!isRecord(parsed) || !isRecord(parsed.summary)) {
    throw new Error("native parity matrix must include a summary object")
  }
  const { missing, routed, total } = parsed.summary
  if (typeof total !== "number" || typeof routed !== "number" || typeof missing !== "number") {
    throw new Error("native parity matrix summary must include numeric total, routed, and missing")
  }
  return { missing, routed, total }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
