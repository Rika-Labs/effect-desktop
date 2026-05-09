import { expect, test, afterEach } from "bun:test"
import { existsSync, rmSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { scaffold, type ScaffoldOptions } from "./index.js"

const testDir = join(tmpdir(), "create-effect-desktop-test")

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
