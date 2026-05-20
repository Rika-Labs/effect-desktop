import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "bun:test"

const repoRoot = join(import.meta.dir, "..")

test("pack-installable-cli emits a workspace-free CLI package installable by a temp app", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-cli-artifact-"))
  try {
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
    expect(packedManifest).toContain('"@effect-desktop/bridge": "file:../bridge"')
    expect(packedManifest).toContain('"@effect-desktop/config": "file:../config"')
    expect(packedManifest).toContain('"@effect-desktop/core": "file:../core"')

    const appRoot = join(directory, "app")
    await mkdir(appRoot)
    await writeFile(
      join(appRoot, "package.json"),
      JSON.stringify({
        type: "module",
        packageManager: "bun@1.3.13",
        dependencies: {
          "@effect-desktop/cli": `file:${join(artifactRoot, "packages", "cli")}`
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
      join(appRoot, "node_modules", "@effect-desktop", "cli", "src", "native-parity-matrix.json"),
      "utf8"
    )
    expect(installedMatrix).toContain('"total": 291')

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
      "native capability matrix reports 291 methods, 229 host-routed, 0 missing host routes"
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 180_000)
