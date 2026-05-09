import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

interface PackageJson {
  readonly name?: string
  readonly dependencies?: Record<string, string>
  readonly [key: string]: unknown
}

const repoRoot = resolve(import.meta.dir, "..")
const destination = process.argv[2]

if (destination === undefined || destination.length === 0) {
  throw new Error("Usage: bun scripts/pack-installable-cli.ts <destination>")
}

const outputRoot = resolve(process.cwd(), destination)
const packageNames = ["bridge", "config", "cli"] as const

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })

for (const name of packageNames) {
  await copyPackage(name)
}

const cliPackagePath = join(outputRoot, "packages", "cli", "package.json")
const cliPackage = (await Bun.file(cliPackagePath).json()) as PackageJson
await writeJson(cliPackagePath, {
  ...cliPackage,
  dependencies: {
    ...cliPackage.dependencies,
    "@effect-desktop/bridge": "file:../bridge",
    "@effect-desktop/config": "file:../config"
  }
})

await installPackageDependencies("bridge")
await installPackageDependencies("config")
await installCliDependencies()

async function copyPackage(name: (typeof packageNames)[number]): Promise<void> {
  const source = join(repoRoot, "packages", name)
  const target = join(outputRoot, "packages", name)
  await mkdir(target, { recursive: true })
  await copyTree(source, target)
}

async function installCliDependencies(): Promise<void> {
  await installPackageDependencies("cli")
}

async function installPackageDependencies(name: (typeof packageNames)[number]): Promise<void> {
  const cliRoot = join(outputRoot, "packages", name)
  const install = Bun.spawn(["bun", "install", "--production"], {
    cwd: cliRoot,
    stdout: "pipe",
    stderr: "pipe"
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(install.stdout).text(),
    new Response(install.stderr).text(),
    install.exited
  ])
  if (exitCode !== 0) {
    throw new Error(`failed to install ${name} artifact dependencies\n${stdout}${stderr}`)
  }
}

async function copyTree(source: string, target: string): Promise<void> {
  const sourceStat = await stat(source)
  if (sourceStat.isDirectory()) {
    if (basename(source) === "node_modules" || basename(source) === ".turbo") {
      return
    }
    await mkdir(target, { recursive: true })
    for await (const entry of new Bun.Glob("*").scan({
      cwd: source,
      dot: true,
      onlyFiles: false
    })) {
      await copyTree(join(source, entry), join(target, entry))
    }
    return
  }

  if (sourceStat.isFile()) {
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
