#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "..")
const binName = (name: string) => (process.platform === "win32" ? `${name}.cmd` : name)
const localBin = (name: string) => join(repoRoot, "node_modules", ".bin", binName(name))

type CommandResult = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

const commandPath = (name: string) => {
  const localPath = localBin(name)
  if (existsSync(localPath)) {
    return localPath
  }
  return name
}

const run = async (command: string, args: ReadonlyArray<string>): Promise<CommandResult> => {
  const process = Bun.spawn([commandPath(command), ...args], {
    cwd: repoRoot,
    stderr: "pipe",
    stdout: "pipe"
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited
  ])
  return { exitCode, stderr, stdout }
}

const version = await run("tsgo", ["--version"])
const versionText = `${version.stdout}${version.stderr}`

if (version.exitCode === 0 && versionText.includes("effect-tsgo")) {
  console.log(`effect-tsgo patch already applied: ${versionText.trim()}`)
  process.exit(0)
}

const patch = await run("effect-tsgo", ["patch"])
process.stdout.write(patch.stdout)
process.stderr.write(patch.stderr)

if (patch.exitCode !== 0) {
  process.exit(patch.exitCode)
}

const patchedVersion = await run("tsgo", ["--version"])
const patchedVersionText = `${patchedVersion.stdout}${patchedVersion.stderr}`

if (patchedVersion.exitCode !== 0 || !patchedVersionText.includes("effect-tsgo")) {
  process.stderr.write("effect-tsgo patch completed but tsgo does not report the Effect build.\n")
  process.stderr.write(patchedVersionText)
  process.exit(1)
}
