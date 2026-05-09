import { expect, test, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

import { scaffold, type ScaffoldOptions } from "./index.js"

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

  expect(() => scaffold(badOptions)).toThrow()
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
