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

    const appRoot = join(directory, "app")
    await mkdir(appRoot)
    await writeFile(
      join(appRoot, "package.json"),
      JSON.stringify({
        type: "module",
        dependencies: {
          "@effect-desktop/cli": `file:${join(artifactRoot, "packages", "cli")}`
        }
      })
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
    expect(helpText).toContain("build       Build renderer, runtime, native host")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
