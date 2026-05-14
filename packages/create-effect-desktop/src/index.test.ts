import { expect, test, afterEach } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

import { Effect } from "effect"

import {
  scaffold,
  TEMPLATE_CATALOG,
  TEMPLATE_NAMES,
  type RendererStorage,
  type ScaffoldOptions
} from "./index.js"

const testDir = join(tmpdir(), "create-effect-desktop-test")
const cliPath = fileURLToPath(new URL("bin.ts", import.meta.url))

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true })
  }
})

function makeOptions(overrides: Partial<ScaffoldOptions> = {}): ScaffoldOptions {
  return {
    name: "test-app",
    template: "local-first-sqlite",
    rendererStorage: "none",
    includeWorkflows: false,
    includeCluster: false,
    outDir: testDir,
    ...overrides
  }
}

const runScaffold = (options: ScaffoldOptions) =>
  Effect.runPromise(scaffold(options).pipe(Effect.provide(BunServices.layer)))

const runScaffoldFailure = (options: ScaffoldOptions) =>
  Effect.runPromise(Effect.flip(scaffold(options).pipe(Effect.provide(BunServices.layer))))

test("scaffold copies local-first-sqlite into outDir", async () => {
  const result = await runScaffold(makeOptions())

  expect(result.path).toBe(testDir)
  expect(result.template).toBe("local-first-sqlite")
  expect(result.sourceTemplate).toBe("local-first-sqlite")
  expect(existsSync(join(testDir, "package.json"))).toBe(true)
  expect(existsSync(join(testDir, "src", "contract.ts"))).toBe(true)
  expect(existsSync(join(testDir, "src", "spine.ts"))).toBe(true)
})

test("scaffold rewrites package name in generated package.json", async () => {
  await runScaffold(makeOptions({ name: "my-custom-app" }))

  const pkg = JSON.parse(readFileSync(join(testDir, "package.json"), "utf8")) as {
    name: string
  }
  expect(pkg.name).toBe("my-custom-app")
})

test("scaffold pins effect to the lockstep version", async () => {
  await runScaffold(makeOptions())

  const pkg = JSON.parse(readFileSync(join(testDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
  }
  expect(pkg.dependencies["effect"]).toBe("4.0.0-beta.60")
})

test("scaffold rewrites workspace dependencies for generated packages", async () => {
  await runScaffold(makeOptions({ template: "local-first-sqlite" }))

  const pkg = JSON.parse(readFileSync(join(testDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
  }
  const workspaceDeps = Object.entries(pkg.dependencies).filter(([, version]) =>
    version.startsWith("workspace:")
  )

  expect(workspaceDeps).toEqual([])
  expect(pkg.dependencies["@effect-desktop/core"]).toBe("0.0.0")
})

test("scaffold rejects non-empty target directories", async () => {
  mkdirSync(testDir, { recursive: true })
  writeFileSync(join(testDir, "existing.txt"), "user-owned")

  const error = await runScaffoldFailure(makeOptions())

  expect(error.message).toContain("already exists and is not empty")
})

test("scaffold adds sqlite-wasm deps when renderer-storage is sqlite-wasm", async () => {
  await runScaffold(makeOptions({ rendererStorage: "sqlite-wasm" }))

  const pkg = JSON.parse(readFileSync(join(testDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
  }
  expect(pkg.dependencies["@effect-desktop/platform-browser"]).toBeDefined()
  expect(pkg.dependencies["@effect/sql-sqlite-wasm"]).toBeUndefined()
  expect(pkg.dependencies["@effect/platform-browser"]).toBeUndefined()
})

test("scaffold adds pglite dep when renderer-storage is pglite", async () => {
  await runScaffold(makeOptions({ rendererStorage: "pglite" }))

  const pkg = JSON.parse(readFileSync(join(testDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
  }
  expect(pkg.dependencies["@effect-desktop/platform-browser"]).toBeDefined()
  expect(pkg.dependencies["@effect/sql-pglite"]).toBeUndefined()
})

test("scaffold copies local-first-sqlite architecture template", async () => {
  const result = await runScaffold(makeOptions({ template: "local-first-sqlite" }))

  expect(result.template).toBe("local-first-sqlite")
  expect(result.architecture.demonstrates).toContain("SqlClientLive")
  expect(existsSync(join(testDir, "src", "contract.ts"))).toBe(true)
})

test("scaffold copies plugin-host architecture template without stub notices", async () => {
  const result = await runScaffold(makeOptions({ template: "plugin-host" }))

  expect(result.template).toBe("plugin-host")
  expect(result.sourceTemplate).toBe("plugin-host")
  expect(result.architecture.demonstrates).toContain("Desktop.make")
})

test("scaffold throws for unknown template path", async () => {
  const options = makeOptions()
  const badOptions = { ...options, template: "does-not-exist" as "local-first-sqlite" }

  const error = await runScaffoldFailure(badOptions)

  expect(error.message).toContain("Unknown template")
})

test("scaffold rejects template traversal at the API boundary", async () => {
  const options = makeOptions()
  const badOptions = { ...options, template: "../package.json" as "local-first-sqlite" }

  const error = await runScaffoldFailure(badOptions)

  expect(error.message).toContain("Unknown template")
})

test("scaffold copies every selectable architecture template", async () => {
  for (const template of TEMPLATE_NAMES) {
    const outDir = join(testDir, template)
    const result = await runScaffold(makeOptions({ outDir, template }))

    expect(result.template).toBe(template)
    expect(TEMPLATE_CATALOG[template].source).toBe(result.sourceTemplate)
    expect(existsSync(join(outDir, "package.json"))).toBe(true)
    expect(existsSync(join(outDir, "src", "App.tsx"))).toBe(true)
  }
})

test("scaffold renderer storage dependency matrix is exact", async () => {
  const cases: ReadonlyArray<{
    readonly storage: RendererStorage
    readonly expected: readonly string[]
    readonly absent: readonly string[]
  }> = [
    {
      storage: "none",
      expected: [],
      absent: ["@effect/platform-browser", "@effect/sql-sqlite-wasm", "@effect/sql-pglite"]
    },
    {
      storage: "indexeddb",
      expected: ["@effect-desktop/platform-browser"],
      absent: ["@effect/platform-browser", "@effect/sql-sqlite-wasm", "@effect/sql-pglite"]
    },
    {
      storage: "sqlite-wasm",
      expected: ["@effect-desktop/platform-browser"],
      absent: ["@effect/platform-browser", "@effect/sql-sqlite-wasm", "@effect/sql-pglite"]
    },
    {
      storage: "pglite",
      expected: ["@effect-desktop/platform-browser"],
      absent: ["@effect/platform-browser", "@effect/sql-sqlite-wasm", "@effect/sql-pglite"]
    }
  ]

  for (const entry of cases) {
    const outDir = join(testDir, entry.storage)
    await runScaffold(makeOptions({ outDir, rendererStorage: entry.storage }))

    const pkg = JSON.parse(readFileSync(join(outDir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>
    }

    for (const dependency of entry.expected) {
      expect(pkg.dependencies[dependency]).toBeDefined()
    }
    for (const dependency of entry.absent) {
      expect(pkg.dependencies[dependency]).toBeUndefined()
    }
  }
})

test("scaffold adds optional companion dependencies only for selected options", async () => {
  const baseDir = join(testDir, "base")
  await runScaffold(makeOptions({ outDir: baseDir }))
  const basePkg = JSON.parse(readFileSync(join(baseDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
  }
  expect(basePkg.dependencies["@effect/platform"]).toBeUndefined()
  expect(basePkg.dependencies["@effect/cluster"]).toBeUndefined()

  const workflowsDir = join(testDir, "workflows")
  await runScaffold(makeOptions({ outDir: workflowsDir, includeWorkflows: true }))
  const workflowsPkg = JSON.parse(readFileSync(join(workflowsDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
  }
  expect(workflowsPkg.dependencies["@effect/platform"]).toBeDefined()
  expect(workflowsPkg.dependencies["@effect/platform-bun"]).toBeDefined()
  expect(workflowsPkg.dependencies["@effect/cluster"]).toBeUndefined()

  const clusterDir = join(testDir, "cluster")
  await runScaffold(makeOptions({ outDir: clusterDir, includeCluster: true }))
  const clusterPkg = JSON.parse(readFileSync(join(clusterDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
  }
  expect(clusterPkg.dependencies["effect"]).toBe("4.0.0-beta.60")
  expect(clusterPkg.dependencies["@effect/cluster"]).toBeUndefined()
})

test("scaffold keeps cluster APIs on the canonical effect package boundary", async () => {
  await runScaffold(makeOptions({ template: "plugin-host", includeCluster: true }))

  const pkg = JSON.parse(readFileSync(join(testDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
  }
  const dependencies = Object.keys(pkg.dependencies)

  expect(pkg.dependencies["effect"]).toBe("4.0.0-beta.60")
  expect(dependencies).not.toContain("@effect/cluster")
  expect(dependencies).toContain("effect")
})

test("cli skips valued flag operands when defaulting the project name", async () => {
  const cwd = join(tmpdir(), "create-effect-desktop-cli-test")
  if (existsSync(cwd)) {
    rmSync(cwd, { recursive: true })
  }
  mkdirSync(cwd, { recursive: true })

  const proc = Bun.spawn({
    cmd: [process.execPath, cliPath, "--template", "local-first-sqlite"],
    cwd,
    stdout: "pipe",
    stderr: "pipe"
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ])

  try {
    expect(exitCode).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("Scaffolding my-effect-desktop-app from template local-first-sqlite")
    expect(existsSync(join(cwd, "my-effect-desktop-app", "package.json"))).toBe(true)
    expect(existsSync(join(cwd, "local-first-sqlite"))).toBe(false)
  } finally {
    if (existsSync(cwd)) {
      rmSync(cwd, { recursive: true })
    }
  }
})

test("cli rejects project names that escape the current directory", async () => {
  const proc = Bun.spawn({
    cmd: [process.execPath, cliPath, "../outside"],
    cwd: tmpdir(),
    stdout: "pipe",
    stderr: "pipe"
  })
  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])

  expect(exitCode).toBe(1)
  expect(stderr).toContain("project name must be a single directory name")
})

test("cli rejects invalid arguments before scaffolding", async () => {
  const cases: ReadonlyArray<{
    readonly args: readonly string[]
    readonly message: string
  }> = [
    { args: ["--template", "does-not-exist"], message: "Invalid value for flag --template" },
    {
      args: ["--renderer-storage", "bad"],
      message: "Invalid value for flag --renderer-storage"
    },
    { args: ["--template"], message: "--template requires a value" },
    { args: ["--renderer-storage"], message: "--renderer-storage requires a value" },
    { args: ["--unknown"], message: "Unrecognized flag: --unknown" },
    { args: ["one", "two"], message: "unexpected positional argument" }
  ]

  for (const [index, entry] of cases.entries()) {
    const cwd = join(tmpdir(), `create-effect-desktop-cli-invalid-${index}`)
    if (existsSync(cwd)) {
      rmSync(cwd, { recursive: true })
    }
    mkdirSync(cwd, { recursive: true })

    const proc = Bun.spawn({
      cmd: [process.execPath, cliPath, ...entry.args],
      cwd,
      stdout: "pipe",
      stderr: "pipe"
    })
    const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])

    try {
      expect(exitCode).toBe(1)
      expect(stderr).toContain(entry.message)
      expect(existsSync(join(cwd, "my-effect-desktop-app"))).toBe(false)
    } finally {
      if (existsSync(cwd)) {
        rmSync(cwd, { recursive: true })
      }
    }
  }
})
