import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { Exit, Schema } from "effect"

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
  "vite"
] as const

const REQUIRED_RUST_CRATES = ["host", "host-protocol", "native-pty", "native-updater"] as const

const REQUIRED_PACKAGE_SCRIPTS = ["check", "typecheck", "test", "lint"] as const

const PHASE_0_STUB_INDEX = "export {}\n"
const PHASE_0_TS_TEST_MARKER = /^\s*(?:test|it)\(["']phase 0 stub compiles and runs["']/m
const PHASE_0_RUST_STUB_INDEX = /^\/\/! Phase 0 stub\.$/m
const PHASE_0_RUST_TEST_MARKER = "fn it_compiles"
const NATIVE_LAYER_HELPER_NAME_PATTERN =
  /\b(make[A-Za-z0-9]+(?:ClientLayer|ServiceLayer|BridgeClientLayer))\b/g
const NATIVE_PACKAGE_EXPORT_BLOCK_PATTERN = /export\s*\{([\s\S]*?)\}\s*from\s+"\.[^"]+\.js"/g
const STALE_PACKAGE_README_PHRASES = [
  "public API remains reserved for Phase 4+",
  "Public renderer-facing APIs",
  "are populated in Phase 4",
  "Phase 3 starts the package",
  "manifest emission land in later phases",
  "None until the package implements native-touching primitives"
] as const
const REACT_WINDOW_HOOK_DOCS = [
  "docs/reference/react/windows.md",
  "docs/how-to/add-a-window.md",
  "docs/tutorials/02-add-a-second-window.md"
] as const

const StringRecord = Schema.Record(Schema.String, Schema.String)

const PackageJson = Schema.Struct({
  dependencies: Schema.optionalKey(StringRecord),
  bin: Schema.optionalKey(StringRecord),
  name: Schema.optionalKey(Schema.String),
  scripts: Schema.optionalKey(StringRecord),
  workspaces: Schema.optionalKey(Schema.Array(Schema.String))
})

const PackageJsonFromString = Schema.fromJsonString(PackageJson)

type PackageJson = typeof PackageJson.Type

const TsConfig = Schema.Struct({
  extends: Schema.optionalKey(Schema.String)
})

const TsConfigFromString = Schema.fromJsonString(TsConfig)

type TsConfig = typeof TsConfig.Type

const readPackageJson = (path: string): PackageJson => {
  const exit = Schema.decodeUnknownExit(PackageJsonFromString)(readFileSync(path, "utf8"))
  if (Exit.isSuccess(exit)) {
    return exit.value
  }
  throw new Error(`PackageJsonParseError at ${path}`, { cause: exit.cause })
}

const readTsConfig = (path: string): TsConfig => {
  const exit = Schema.decodeUnknownExit(TsConfigFromString)(readFileSync(path, "utf8"))
  if (Exit.isSuccess(exit)) {
    return exit.value
  }
  throw new Error(`TsConfigParseError at ${path}`, { cause: exit.cause })
}

const collectMarkdownFiles = (directory: string): ReadonlyArray<string> => {
  const files: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(path))
      continue
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path)
    }
  }

  return files
}

const collectNativePackageLayerHelpers = (): ReadonlySet<string> => {
  const index = readFileSync(join(REPO_ROOT, "packages/native/src/index.ts"), "utf8")
  const helpers = new Set<string>()

  for (const exportBlock of index.matchAll(NATIVE_PACKAGE_EXPORT_BLOCK_PATTERN)) {
    const exportedNames = exportBlock[1]
    if (exportedNames === undefined) {
      continue
    }

    for (const match of exportedNames.matchAll(NATIVE_LAYER_HELPER_NAME_PATTERN)) {
      const helper = match[1]
      if (helper !== undefined) {
        helpers.add(helper)
      }
    }
  }

  return helpers
}

describe("workspaces", () => {
  const root = readPackageJson(join(REPO_ROOT, "package.json"))

  test("root package.json declares the spec §5.4 globs", () => {
    expect(root.workspaces).toEqual(["apps/*", "packages/*"])
  })

  test("root package.json exposes the documented bun desktop entrypoint", () => {
    expect(root.scripts?.["desktop"]).toBe("bun packages/cli/src/bin.ts")
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
      "build       Build renderer, runtime, native host, bridge manifest, and app manifest"
    )
  })
})

describe("root README", () => {
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8")

  test("repository map only links package directories with manifests", () => {
    const packageLinks = readme.matchAll(/\]\(packages\/([^)]+)\)/g)
    for (const match of packageLinks) {
      const packageName = match[1]
      if (packageName === undefined) {
        throw new Error("README package link regex produced no package name")
      }
      expect(existsSync(join(REPO_ROOT, "packages", packageName, "package.json"))).toBe(true)
    }
  })
})

describe("package READMEs", () => {
  test("do not carry stale phase-gate placeholders", () => {
    const violations: string[] = []

    for (const path of collectMarkdownFiles(join(REPO_ROOT, "packages")).filter((file) =>
      file.endsWith("/README.md")
    )) {
      const readme = readFileSync(path, "utf8")
      for (const phrase of STALE_PACKAGE_README_PHRASES) {
        if (readme.includes(phrase)) {
          violations.push(`${path.slice(REPO_ROOT.length + 1)}: remove stale phrase "${phrase}"`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})

describe("@orika/cli package manifest", () => {
  const cli = readPackageJson(join(REPO_ROOT, "packages", "cli", "package.json"))

  test("bin points at the checked-in executable entrypoint", () => {
    expect(cli.bin?.["desktop"]).toBe("src/bin.ts")
  })

  test("workspace manifest keeps first-party dependencies linked in-repo", () => {
    expect(cli.dependencies?.["@orika/bridge"]).toBe("workspace:*")
    expect(cli.dependencies?.["@orika/config"]).toBe("workspace:*")
  })
})

describe("packages/*", () => {
  for (const name of REQUIRED_TS_PACKAGES) {
    const dir = join(REPO_ROOT, "packages", name)

    test(`${name} directory exists`, () => {
      expect(statSync(dir).isDirectory()).toBe(true)
    })

    test(`${name}/package.json declares all required scripts`, () => {
      const pkg = readPackageJson(join(dir, "package.json"))
      const scripts = pkg.scripts ?? {}
      for (const required of REQUIRED_PACKAGE_SCRIPTS) {
        expect(scripts[required]).toBeDefined()
      }
    })

    test(`${name}/tsconfig.json extends the workspace base`, () => {
      const tsc = readTsConfig(join(dir, "tsconfig.json"))
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

describe("architecture debt guardrails", () => {
  const removedEffectWrapperModules = [
    "packages/core/src/runtime/platform.ts",
    "packages/core/src/runtime/reactivity.ts",
    "packages/core/src/runtime/workflow.ts"
  ] as const

  for (const path of removedEffectWrapperModules) {
    test(`${path} does not reappear as a zero-policy Effect wrapper`, () => {
      expect(existsSync(join(REPO_ROOT, path))).toBe(false)
    })
  }

  test("packages/core/src/runtime/event-log.ts is desktop policy, not a zero-policy Effect wrapper", () => {
    const source = readFileSync(join(REPO_ROOT, "packages/core/src/runtime/event-log.ts"), "utf8")
    expect(source).toContain("DesktopEventLog")
    expect(source).toContain("DesktopEventSchema")
    expect(source).not.toMatch(/export\s+\{[^}]+}\s+from\s+"effect\/unstable\/eventlog"/)
  })
})

describe("native reference docs", () => {
  test("layer helper names refer to public @orika/native exports", () => {
    const publicHelpers = collectNativePackageLayerHelpers()
    const violations: string[] = []

    for (const path of collectMarkdownFiles(join(REPO_ROOT, "docs/reference/native"))) {
      const markdown = readFileSync(path, "utf8")
      for (const match of markdown.matchAll(NATIVE_LAYER_HELPER_NAME_PATTERN)) {
        const helper = match[1]
        if (helper === undefined || publicHelpers.has(helper)) {
          continue
        }

        violations.push(
          `${path.slice(REPO_ROOT.length + 1)}: ${helper} is not exported by packages/native/src/index.ts`
        )
      }
    }

    expect(violations).toEqual([])
  })
})

describe("React window docs", () => {
  test("model current-window hooks as Effect Options", () => {
    const violations: string[] = []

    for (const relativePath of REACT_WINDOW_HOOK_DOCS) {
      const markdown = readFileSync(join(REPO_ROOT, relativePath), "utf8")
      if (!markdown.includes("useCurrentWindowId")) {
        continue
      }

      if (!markdown.includes("Option.Option")) {
        violations.push(`${relativePath}: describe the current-window hook return type as Option`)
      }
      if (!markdown.includes("Option.match")) {
        violations.push(`${relativePath}: route current-window ids with Option.match`)
      }
      if (/useCurrentWindow(?:Id)?\(\)[\s\S]{0,180}undefined/i.test(markdown)) {
        violations.push(`${relativePath}: do not document current-window hooks as undefined`)
      }
      if (/useCurrentWindowId\(\)[\s\S]{0,220}returns (?:just )?the id/i.test(markdown)) {
        violations.push(`${relativePath}: do not document useCurrentWindowId as a raw id`)
      }
      if (
        /const\s+([A-Za-z_$][\w$]*)\s*=\s*useCurrentWindowId\(\)[\s\S]{0,260}(?:\1\s*===\s*["']|switch\s*\(\s*\1\s*\))/m.test(
          markdown
        )
      ) {
        violations.push(`${relativePath}: do not compare the Option result directly`)
      }
    }

    expect(violations).toEqual([])
  })
})
