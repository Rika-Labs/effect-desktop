import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dir, "..")

const REQUIRED_TS_PACKAGES = [
  "core",
  "bridge",
  "native",
  "react",
  "cli",
  "devtools",
  "test",
  "config",
  "create-effect-desktop",
  "vite"
] as const

const REQUIRED_RUST_CRATES = ["host", "host-protocol", "native-pty", "native-updater"] as const

const REQUIRED_PACKAGE_SCRIPTS = ["check", "typecheck", "test", "lint"] as const

const PHASE_0_STUB_INDEX = "export {}\n"
const PHASE_0_TS_TEST_MARKER = /^\s*(?:test|it)\(["']phase 0 stub compiles and runs["']/m
const PHASE_0_RUST_STUB_INDEX = /^\/\/! Phase 0 stub\.$/m
const PHASE_0_RUST_TEST_MARKER = "fn it_compiles"

interface PackageJson {
  dependencies?: Record<string, string>
  bin?: Record<string, string>
  name?: string
  scripts?: Record<string, string>
  workspaces?: ReadonlyArray<string>
  [key: string]: unknown
}

interface TsConfig {
  extends?: string
  [key: string]: unknown
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T

describe("workspaces", () => {
  const root = readJson<PackageJson>(join(REPO_ROOT, "package.json"))

  test("root package.json declares the spec §5.4 globs", () => {
    expect(root.workspaces).toEqual(["apps/*", "apps/examples/*", "packages/*", "templates/*"])
  })

  test("root package.json exposes the documented bun desktop entrypoint", () => {
    expect(root.scripts?.desktop).toBe("bun packages/cli/src/bin.ts")
  })

  test("bun desktop resolves to the CLI instead of a missing Bun script", async () => {
    const proc = Bun.spawn(["bun", "desktop"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe"
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited
    ])

    expect(exitCode).toBe(1)
    expect(stderr).not.toContain('Script not found "desktop"')
    const helpText = stdout + stderr
    expect(helpText).toContain("USAGE\n  desktop <subcommand> [flags]")
    expect(helpText).toContain(
      "build             Build renderer, runtime, native host, bridge manifest, and app manifest"
    )
  })
})

describe("@effect-desktop/cli package manifest", () => {
  const cli = readJson<PackageJson>(join(REPO_ROOT, "packages", "cli", "package.json"))

  test("bin points at the checked-in executable entrypoint", () => {
    expect(cli.bin?.desktop).toBe("src/bin.ts")
  })

  test("workspace manifest keeps first-party dependencies linked in-repo", () => {
    expect(cli.dependencies?.["@effect-desktop/bridge"]).toBe("workspace:*")
    expect(cli.dependencies?.["@effect-desktop/config"]).toBe("workspace:*")
  })
})

describe("packages/*", () => {
  for (const name of REQUIRED_TS_PACKAGES) {
    const dir = join(REPO_ROOT, "packages", name)

    test(`${name} directory exists`, () => {
      expect(statSync(dir).isDirectory()).toBe(true)
    })

    test(`${name}/package.json declares all required scripts`, () => {
      const pkg = readJson<PackageJson>(join(dir, "package.json"))
      const scripts = pkg.scripts ?? {}
      for (const required of REQUIRED_PACKAGE_SCRIPTS) {
        expect(scripts[required]).toBeDefined()
      }
    })

    test(`${name}/tsconfig.json extends the workspace base`, () => {
      const tsc = readJson<TsConfig>(join(dir, "tsconfig.json"))
      expect(tsc.extends).toBe("../../tsconfig.base.json")
    })

    test(`${name} stub markers are aligned (real src means real test)`, () => {
      const indexPath = join(dir, "src/index.ts")
      const testPath = join(dir, "src/index.test.ts")
      const indexBody = readFileSync(indexPath, "utf8")
      const testBody = readFileSync(testPath, "utf8")

      const isStubIndex = indexBody === PHASE_0_STUB_INDEX
      const isStubTest = PHASE_0_TS_TEST_MARKER.test(testBody)

      // Allowed: stub index + stub test (Phase 0 baseline) OR real index + real test.
      // Forbidden: real index alongside the Phase 0 tautology test.
      if (!isStubIndex && isStubTest) {
        throw new Error(
          `${name}/src/index.ts has real exports but src/index.test.ts still contains the Phase 0 tautology marker — write a real test for the new code.`
        )
      }
    })
  }
})

describe("crates/*", () => {
  const cargoToml = readFileSync(join(REPO_ROOT, "Cargo.toml"), "utf8")

  for (const name of REQUIRED_RUST_CRATES) {
    test(`${name} is listed in Cargo.toml workspace members`, () => {
      expect(cargoToml).toContain(`"crates/${name}"`)
    })

    test(`${name} stub markers are aligned (real lib means real test)`, () => {
      const libPath = join(REPO_ROOT, "crates", name, "src/lib.rs")
      const lib = readFileSync(libPath, "utf8")
      // Marker contract: a Phase 0 stub crate carries a `//! Phase 0 stub.` doc
      // comment. When implementation lands, the contributor removes the comment
      // first. After that, the placeholder `fn it_compiles` must also go.
      const carriesStubMarker = PHASE_0_RUST_STUB_INDEX.test(lib)
      const hasStubTest = lib.includes(PHASE_0_RUST_TEST_MARKER)

      if (!carriesStubMarker && hasStubTest) {
        throw new Error(
          `crates/${name}/src/lib.rs has dropped the \`Phase 0 stub.\` marker but still contains \`fn it_compiles\` — replace the placeholder with a real test.`
        )
      }
    })
  }

  test("no extra crate directory is missing from Cargo.toml workspace members", () => {
    const cratesDir = join(REPO_ROOT, "crates")
    const present = readdirSync(cratesDir).filter((entry) =>
      statSync(join(cratesDir, entry)).isDirectory()
    )
    for (const crate of present) {
      expect(cargoToml).toContain(`"crates/${crate}"`)
    }
  })
})
