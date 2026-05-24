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
const CURRENT_WINDOW_VOID_MUTATION_PAYLOAD_PATTERN =
  /use(?:Close|Destroy)CurrentWindowMutation[\s\S]{0,500}\.run\(\s*\{\s*\}\s*\)/m
const AWAITED_MUTATION_RUN_PATTERN = /\bawait\s+[A-Za-z_$][\w$]*\.run\(/
const MARKDOWN_CODE_BLOCK_PATTERN = /```[^\n]*\n([\s\S]*?)```/g
const RAW_DESKTOP_MAKE_WINDOWS_PATTERN = /Desktop\.make\(\s*\{[\s\S]{0,600}\bwindows:\s*\{/m
const RUNTIME_MANIFEST_MODULE_PATTERN =
  /export\s+const\s+App\s*=\s*Desktop\.make\([\s\S]*?export\s+const\s+Manifest\s*=\s*Desktop\.manifest\(App\)/m
const RENDERER_MANIFEST_IMPORT_PATTERN =
  /import\s*\{\s*Manifest\s*\}\s*from\s+["'][^"']*manifest\.js["']/m
const RENDERER_MANIFEST_IMPORT_GLOBAL_PATTERN =
  /import\s*\{\s*Manifest\s*\}\s*from\s+["']([^"']*manifest\.js)["']/g
const CORE_PERMISSION_REGISTRY_LIVE_IMPORT_PATTERN =
  /import\s*\{[^}]*\bPermissionRegistryLive\b[^}]*\}\s*from\s+"@orika\/core"/m
const CURRENT_WINDOW_ID_LITERAL_ROUTING_PATTERN =
  /useCurrentWindowId\(\)[\s\S]{0,500}onSome:\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>[\s\S]{0,220}\b\1\s*===\s*["']/m
const STALE_PTY_HANDLE_DOC_PATTERN =
  /\bsession\.signal\(|\|\s*`list`\s*\||readonly\s+(?:signal|close|exit)\s*:/m
const STALE_PTY_PERMISSION_DOC_PATTERN = /\bprocess\.spawn\b/
const STALE_PTY_PRODUCTION_ADAPTER_DOC_PATTERN =
  /\bProduction uses\b[^\n]*(?:native PTY backend|`crates\/native-pty`)/
const STALE_PTY_UNSUPPORTED_NATIVE_LAYER_DOC_PATTERN =
  /\bfail-closed\b|HostProtocolUnsupportedError|does not expose PTY methods/
const STALE_COMMAND_REFERENCE_TOKENS = [
  "Command,",
  "type CommandApi",
  "type CommandInvocation",
  "type CommandRegistrationError",
  "CommandError",
  "`register`",
  "({ id, name, run })",
  "(id, args?)"
] as const
const STALE_SIDECAR_REFERENCE_TOKENS = [
  "`spawn`",
  "`wait`",
  "`list`",
  "Sidecar.spawn",
  "SidecarSnapshot"
] as const
const STALE_WORKER_DOC_TOKENS = [
  "WorkerHandle<I, O>",
  "Effect<WorkerHandle<I, O>>",
  "  id: string",
  "status, uptime, capabilities"
] as const
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
const RENDERER_SAFE_NATIVE_DOCS = {
  clipboard: "ClipboardRpcs",
  dialog: "DialogRpcs",
  notification: "NotificationRpcs",
  path: "PathRpcs",
  screen: "ScreenRpcs",
  shell: "ShellRpcs",
  "system-appearance": "SystemAppearanceRpcs"
} as const

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

  test("renderer-safe native RPC references show the renderer import", () => {
    const violations: string[] = []

    for (const [slug, rpcsName] of Object.entries(RENDERER_SAFE_NATIVE_DOCS)) {
      const relativePath = `docs/reference/native/${slug}.md`
      const markdown = readFileSync(join(REPO_ROOT, relativePath), "utf8")
      if (!markdown.includes(`import { ${rpcsName} as Renderer${rpcsName} }`)) {
        violations.push(`${relativePath}: missing renderer-safe ${rpcsName} import`)
      }
      if (!markdown.includes('from "@orika/native/renderer"')) {
        violations.push(`${relativePath}: missing @orika/native/renderer import`)
      }
    }

    expect(violations).toEqual([])
  })
})

describe("Desktop API docs", () => {
  test("Desktop.make examples use window declaration helpers", () => {
    const violations: string[] = []

    for (const path of collectMarkdownFiles(join(REPO_ROOT, "docs"))) {
      const markdown = readFileSync(path, "utf8")
      for (const codeBlock of markdown.matchAll(MARKDOWN_CODE_BLOCK_PATTERN)) {
        const source = codeBlock[1]
        if (source === undefined || !RAW_DESKTOP_MAKE_WINDOWS_PATTERN.test(source)) {
          continue
        }

        violations.push(
          `${path.slice(
            REPO_ROOT.length + 1
          )}: use Desktop.window(...) or Desktop.windows(...), not raw windows records`
        )
      }
    }

    expect(violations).toEqual([])
  })

  test("renderer examples do not import runtime manifest modules", () => {
    const violations: string[] = []

    for (const path of collectMarkdownFiles(join(REPO_ROOT, "docs"))) {
      const markdown = readFileSync(path, "utf8")
      if (
        RUNTIME_MANIFEST_MODULE_PATTERN.test(markdown) &&
        RENDERER_MANIFEST_IMPORT_PATTERN.test(markdown)
      ) {
        violations.push(
          `${path.slice(
            REPO_ROOT.length + 1
          )}: split runtime Desktop.make modules from browser-safe renderer manifests`
        )
      }
    }

    expect(violations).toEqual([])
  })

  test("renderer examples import browser-safe renderer manifests", () => {
    const violations: string[] = []

    for (const path of collectMarkdownFiles(join(REPO_ROOT, "docs"))) {
      const markdown = readFileSync(path, "utf8")
      for (const match of markdown.matchAll(RENDERER_MANIFEST_IMPORT_GLOBAL_PATTERN)) {
        const specifier = match[1]
        if (specifier === undefined || specifier.endsWith("renderer-manifest.js")) {
          continue
        }

        violations.push(
          `${path.slice(REPO_ROOT.length + 1)}: import Manifest from renderer-manifest.js`
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
      const hasCurrentWindowIdExample =
        /import\s*\{[\s\S]{0,120}\buseCurrentWindowId\b[\s\S]{0,120}}\s*from\s+"@orika\/react"/m.test(
          markdown
        ) || /const\s+[A-Za-z_$][\w$]*\s*=\s*useCurrentWindowId\(\)/m.test(markdown)
      if (!hasCurrentWindowIdExample) {
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
      if (CURRENT_WINDOW_ID_LITERAL_ROUTING_PATTERN.test(markdown)) {
        violations.push(
          `${relativePath}: do not route renderer views by comparing current host window ids to literals`
        )
      }
      if (CURRENT_WINDOW_VOID_MUTATION_PAYLOAD_PATTERN.test(markdown)) {
        violations.push(`${relativePath}: call current-window close/destroy mutations with run()`)
      }
    }

    expect(violations).toEqual([])
  })
})

describe("React mutation docs", () => {
  test("use runPromise for awaited mutation completion", () => {
    const violations: string[] = []

    for (const path of collectMarkdownFiles(join(REPO_ROOT, "docs"))) {
      const markdown = readFileSync(path, "utf8")
      if (!markdown.includes("useMutation")) {
        continue
      }

      if (AWAITED_MUTATION_RUN_PATTERN.test(markdown)) {
        violations.push(
          `${path.slice(REPO_ROOT.length + 1)}: use runPromise() when awaiting mutation completion`
        )
      }
    }

    expect(violations).toEqual([])
  })
})

describe("SQLite docs", () => {
  test("do not import nonexistent permission registry live layer", () => {
    const violations: string[] = []
    const markdownPaths = [
      ...collectMarkdownFiles(join(REPO_ROOT, "docs")),
      join(REPO_ROOT, "packages/core/README.md")
    ]

    for (const path of markdownPaths) {
      const markdown = readFileSync(path, "utf8")
      if (CORE_PERMISSION_REGISTRY_LIVE_IMPORT_PATTERN.test(markdown)) {
        violations.push(
          `${path.slice(REPO_ROOT.length + 1)}: construct PermissionRegistry layers from PermissionRegistry.make`
        )
      }
    }

    expect(violations).toEqual([])
  })

  test("standalone setup uses exported permission registry symbols", () => {
    const markdown = readFileSync(join(REPO_ROOT, "docs/how-to/use-sqlite.md"), "utf8")

    expect(markdown).not.toContain("PermissionRegistryLive")
    expect(markdown).toContain("PermissionRegistry")
    expect(markdown).toContain("ResourceRegistryLive")
    expect(markdown).toContain("PermissionRegistry.make")
  })
})

describe("Command docs", () => {
  test("model the current CommandRegistry API", () => {
    const reference = readFileSync(join(REPO_ROOT, "docs/reference/services/command.md"), "utf8")
    const violations: string[] = []

    for (const token of STALE_COMMAND_REFERENCE_TOKENS) {
      if (reference.includes(token)) {
        violations.push(`docs/reference/services/command.md: remove stale ${token} API docs`)
      }
    }

    for (const token of [
      "CommandRegistry",
      "DesktopCommands",
      "registerGroup",
      "PermissionContext",
      "CommandInvocationRecord",
      "CommandRegistryError"
    ] as const) {
      if (!reference.includes(token)) {
        violations.push(`docs/reference/services/command.md: document ${token}`)
      }
    }

    expect(violations).toEqual([])
  })
})

describe("Sidecar docs", () => {
  test("model the current Sidecar start API", () => {
    const reference = readFileSync(join(REPO_ROOT, "docs/reference/services/sidecar.md"), "utf8")
    const violations: string[] = []

    for (const token of STALE_SIDECAR_REFERENCE_TOKENS) {
      if (reference.includes(token)) {
        violations.push(`docs/reference/services/sidecar.md: remove stale ${token} API docs`)
      }
    }

    for (const token of [
      "SidecarCommand",
      "SidecarStartOptions",
      "SidecarReadiness",
      "SidecarHandle",
      "`start`",
      "`ready`",
      "`events`",
      "`close`"
    ] as const) {
      if (!reference.includes(token)) {
        violations.push(`docs/reference/services/sidecar.md: document ${token}`)
      }
    }

    expect(violations).toEqual([])
  })
})

describe("Worker docs", () => {
  test("model the current Worker handle and snapshot API", () => {
    const reference = readFileSync(join(REPO_ROOT, "docs/reference/services/worker.md"), "utf8")
    const howTo = readFileSync(join(REPO_ROOT, "docs/how-to/spawn-a-worker.md"), "utf8")
    const combined = `${reference}\n${howTo}`
    const violations: string[] = []

    for (const token of STALE_WORKER_DOC_TOKENS) {
      if (combined.includes(token)) {
        violations.push(`Worker docs: remove stale ${token} wording`)
      }
    }

    for (const token of [
      "WorkerHandle<Out>",
      "resource:",
      "ManagedResourceHandle",
      "WorkerSnapshot",
      "uptimeMs",
      "WorkerLive",
      "WorkerLayer"
    ] as const) {
      if (!reference.includes(token)) {
        violations.push(`docs/reference/services/worker.md: document ${token}`)
      }
    }

    expect(violations).toEqual([])
  })
})

describe("PTY docs", () => {
  test("model the current public handle API", () => {
    const violations: string[] = []
    const handleDocs = ["docs/how-to/open-a-pty.md", "docs/reference/services/pty.md"] as const

    for (const relativePath of handleDocs) {
      const markdown = readFileSync(join(REPO_ROOT, relativePath), "utf8")
      if (STALE_PTY_HANDLE_DOC_PATTERN.test(markdown)) {
        violations.push(`${relativePath}: document PtyHandle.kill/onExit, not stale aliases`)
      }
      if (STALE_PTY_PERMISSION_DOC_PATTERN.test(markdown)) {
        violations.push(`${relativePath}: document pty.spawn policy, not process.spawn`)
      }
      if (STALE_PTY_PRODUCTION_ADAPTER_DOC_PATTERN.test(markdown)) {
        violations.push(
          `${relativePath}: distinguish the Rust PTY backend from an app-facing production adapter`
        )
      }
      if (STALE_PTY_UNSUPPORTED_NATIVE_LAYER_DOC_PATTERN.test(markdown)) {
        violations.push(`${relativePath}: document NativePtyLayer as host-backed, not unsupported`)
      }
    }

    const howTo = readFileSync(join(REPO_ROOT, "docs/how-to/open-a-pty.md"), "utf8")
    const reference = readFileSync(join(REPO_ROOT, "docs/reference/services/pty.md"), "utf8")
    const errors = readFileSync(join(REPO_ROOT, "docs/reference/errors.md"), "utf8")
    const mockPty = readFileSync(
      join(REPO_ROOT, "docs/reference/test/mock-process-and-pty.md"),
      "utf8"
    )
    const ptys = readFileSync(join(REPO_ROOT, "docs/ptys.md"), "utf8")

    if (!howTo.includes('session.kill("SIGINT")') || !howTo.includes("session.onExit")) {
      violations.push("docs/how-to/open-a-pty.md: show kill(signal?) and onExit")
    }
    if (
      !reference.includes("type PtyHandle") ||
      !reference.includes("onExit") ||
      !reference.includes("kill:") ||
      !reference.includes("outputMetrics")
    ) {
      violations.push("docs/reference/services/pty.md: document the current PtyHandle shape")
    }
    if (errors.includes("`signal`, `close`")) {
      violations.push("docs/reference/errors.md: name current PTY operations")
    }
    if (mockPty.includes("signal, close calls")) {
      violations.push("docs/reference/test/mock-process-and-pty.md: name kill and cleanup records")
    }
    if (!ptys.includes("PtyOpenOptions") || !ptys.includes("PtyHandle")) {
      violations.push("docs/ptys.md: list current public PTY handle types")
    }

    expect(violations).toEqual([])
  })
})
