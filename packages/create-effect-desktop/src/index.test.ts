import { expect, test, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

import { scaffold, TEMPLATE_NAMES, type RendererStorage, type ScaffoldOptions } from "./index.js"

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
    template: "basic-react-tailwind",
    rendererStorage: "none",
    includeWorkflows: false,
    includeCluster: false,
    outDir: testDir,
    ...overrides
  }
}

test("scaffold copies basic-react-tailwind into outDir", () => {
  const result = scaffold(makeOptions())

  expect(result.path).toBe(testDir)
  expect(result.template).toBe("basic-react-tailwind")
  expect(existsSync(join(testDir, "package.json"))).toBe(true)
  expect(existsSync(join(testDir, "src", "contract.ts"))).toBe(true)
  expect(existsSync(join(testDir, "src", "spine.ts"))).toBe(true)
})

test("scaffold rewrites package name in generated package.json", () => {
  scaffold(makeOptions({ name: "my-custom-app" }))

  const pkg = JSON.parse(readFileSync(join(testDir, "package.json"), "utf8")) as {
    name: string
  }
  expect(pkg.name).toBe("my-custom-app")
})

test("scaffold pins effect to the lockstep version", () => {
  scaffold(makeOptions())

  const pkg = JSON.parse(readFileSync(join(testDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
  }
  expect(pkg.dependencies["effect"]).toBe("4.0.0-beta.60")
})

test("scaffold rewrites workspace dependencies for generated packages", () => {
  scaffold(makeOptions({ template: "todo-sqlite" }))

  const pkg = JSON.parse(readFileSync(join(testDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
  }
  const workspaceDeps = Object.entries(pkg.dependencies).filter(([, version]) =>
    version.startsWith("workspace:")
  )

  expect(workspaceDeps).toEqual([])
  expect(pkg.dependencies["@effect-desktop/core"]).toBe("0.0.0")
})

test("scaffold rejects non-empty target directories", () => {
  mkdirSync(testDir, { recursive: true })
  writeFileSync(join(testDir, "existing.txt"), "user-owned")

  expect(() => scaffold(makeOptions())).toThrow("already exists and is not empty")
})

test("scaffold adds sqlite-wasm deps when renderer-storage is sqlite-wasm", () => {
  scaffold(makeOptions({ rendererStorage: "sqlite-wasm" }))

  const pkg = JSON.parse(readFileSync(join(testDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
  }
  expect(pkg.dependencies["@effect/sql-sqlite-wasm"]).toBeDefined()
  expect(pkg.dependencies["@effect/platform-browser"]).toBeDefined()
})

test("scaffold adds pglite dep when renderer-storage is pglite", () => {
  scaffold(makeOptions({ rendererStorage: "pglite" }))

  const pkg = JSON.parse(readFileSync(join(testDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
  }
  expect(pkg.dependencies["@effect/sql-pglite"]).toBeDefined()
})

test("scaffold copies todo-sqlite template", () => {
  const result = scaffold(makeOptions({ template: "todo-sqlite" }))

  expect(result.template).toBe("todo-sqlite")
  expect(existsSync(join(testDir, "src", "contract.ts"))).toBe(true)
  expect(result.stubs).toHaveLength(0)
})

test("scaffold returns stubs notice for multi-window template", () => {
  const result = scaffold(makeOptions({ template: "multi-window" }))

  expect(result.stubs.length).toBeGreaterThan(0)
  expect(result.stubs[0]).toContain("T29")
})

test("scaffold throws for unknown template path", () => {
  const options = makeOptions()
  const badOptions = { ...options, template: "does-not-exist" as "basic-react-tailwind" }

  expect(() => scaffold(badOptions)).toThrow("Unknown template")
})

test("scaffold rejects template traversal at the API boundary", () => {
  const options = makeOptions()
  const badOptions = { ...options, template: "../package.json" as "basic-react-tailwind" }

  expect(() => scaffold(badOptions)).toThrow("Unknown template")
})

test("scaffold copies every selectable template", () => {
  for (const template of TEMPLATE_NAMES) {
    const outDir = join(testDir, template)
    const result = scaffold(makeOptions({ outDir, template }))

    expect(result.template).toBe(template)
    expect(existsSync(join(outDir, "package.json"))).toBe(true)
    expect(existsSync(join(outDir, "src", "App.tsx"))).toBe(true)
  }
})

test("scaffold renderer storage dependency matrix is exact", () => {
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
      expected: ["@effect/platform-browser"],
      absent: ["@effect/sql-sqlite-wasm", "@effect/sql-pglite"]
    },
    {
      storage: "sqlite-wasm",
      expected: ["@effect/platform-browser", "@effect/sql-sqlite-wasm"],
      absent: ["@effect/sql-pglite"]
    },
    {
      storage: "pglite",
      expected: ["@effect/platform-browser", "@effect/sql-pglite"],
      absent: ["@effect/sql-sqlite-wasm"]
    }
  ]

  for (const entry of cases) {
    const outDir = join(testDir, entry.storage)
    scaffold(makeOptions({ outDir, rendererStorage: entry.storage }))

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

test("scaffold adds optional companion dependencies only for selected options", () => {
  const baseDir = join(testDir, "base")
  scaffold(makeOptions({ outDir: baseDir }))
  const basePkg = JSON.parse(readFileSync(join(baseDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
  }
  expect(basePkg.dependencies["@effect/platform"]).toBeUndefined()
  expect(basePkg.dependencies["@effect/cluster"]).toBeUndefined()

  const workflowsDir = join(testDir, "workflows")
  scaffold(makeOptions({ outDir: workflowsDir, includeWorkflows: true }))
  const workflowsPkg = JSON.parse(readFileSync(join(workflowsDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
  }
  expect(workflowsPkg.dependencies["@effect/platform"]).toBeDefined()
  expect(workflowsPkg.dependencies["@effect/platform-bun"]).toBeDefined()
  expect(workflowsPkg.dependencies["@effect/cluster"]).toBeUndefined()

  const clusterDir = join(testDir, "cluster")
  scaffold(makeOptions({ outDir: clusterDir, includeCluster: true }))
  const clusterPkg = JSON.parse(readFileSync(join(clusterDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>
  }
  expect(clusterPkg.dependencies["@effect/cluster"]).toBeDefined()
})

test("cli skips valued flag operands when defaulting the project name", async () => {
  const cwd = join(tmpdir(), "create-effect-desktop-cli-test")
  if (existsSync(cwd)) {
    rmSync(cwd, { recursive: true })
  }
  mkdirSync(cwd, { recursive: true })

  const proc = Bun.spawn({
    cmd: [process.execPath, cliPath, "--template", "todo-sqlite"],
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
    expect(stdout).toContain("Scaffolding my-effect-desktop-app from template todo-sqlite")
    expect(existsSync(join(cwd, "my-effect-desktop-app", "package.json"))).toBe(true)
    expect(existsSync(join(cwd, "todo-sqlite"))).toBe(false)
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
    { args: ["--template", "does-not-exist"], message: "unknown template" },
    { args: ["--renderer-storage", "bad"], message: "unknown renderer-storage" },
    { args: ["--template"], message: "--template requires a value" },
    { args: ["--renderer-storage"], message: "--renderer-storage requires a value" },
    { args: ["--unknown"], message: "unknown option" },
    { args: ["one", "two"], message: "unexpected positional argument" }
  ]

  for (const entry of cases) {
    const cwd = join(tmpdir(), `create-effect-desktop-cli-invalid-${entry.message}`)
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
