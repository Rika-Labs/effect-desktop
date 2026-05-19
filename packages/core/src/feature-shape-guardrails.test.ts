import { expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Effect, FileSystem, ManagedRuntime, Path } from "effect"

const repoRoot = new URL("../../..", import.meta.url).pathname
const searchedRoots = ["apps", "docs", "packages", "templates"] as const
const ignoredDirectories = new Set(["node_modules", "repos", ".git", "dist", ".turbo"])
const textExtensions = new Set([".md", ".ts", ".tsx", ".js", ".jsx", ".json"])
const nativeSurfaces = [
  "App",
  "Clipboard",
  "ContextMenu",
  "CrashReporter",
  "Dialog",
  "Dock",
  "GlobalShortcut",
  "Menu",
  "Notification",
  "Path",
  "PowerMonitor",
  "Protocol",
  "SafeStorage",
  "Screen",
  "SystemAppearance",
  "Tray",
  "Updater",
  "WebView",
  "Window"
] as const

const GuardrailRuntime = ManagedRuntime.make(BunServices.layer)

const collectFiles = (roots: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const found: Array<string> = []

    const visit = (directory: string): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const entries = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []))
        for (const entry of entries) {
          if (ignoredDirectories.has(entry)) {
            continue
          }
          const entryPath = path.join(directory, entry)
          const info = yield* fs.stat(entryPath).pipe(Effect.orElseSucceed(() => undefined))
          if (info === undefined) {
            continue
          }
          if (info.type === "Directory") {
            yield* visit(entryPath)
            continue
          }
          const extension = entry.slice(entry.lastIndexOf("."))
          if (textExtensions.has(extension)) {
            found.push(entryPath)
          }
        }
      })

    for (const root of roots) {
      const rootPath = path.join(repoRoot, root)
      if (yield* fs.exists(rootPath)) {
        yield* visit(rootPath)
      }
    }
    return found as ReadonlyArray<string>
  })

const matchingFiles = (pattern: RegExp) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const all = yield* collectFiles(searchedRoots)
    const selfPath = new URL(import.meta.url).pathname
    const matched: Array<string> = []
    for (const file of all) {
      if (file === selfPath) {
        continue
      }
      const contents = yield* fs.readFileString(file)
      if (pattern.test(contents)) {
        matched.push(path.relative(repoRoot, file))
      }
    }
    return matched as ReadonlyArray<string>
  })

test("feature declarations do not reintroduce declaration registries or snapshots", () =>
  GuardrailRuntime.runPromise(
    Effect.gen(function* () {
      const matches = yield* matchingFiles(
        /snapshotDeclarationLayerSync|Desktop(?:Rpc|Native|Permission|Workflow|Window|Provider)Registry/
      )
      expect(matches).toEqual([])
    })
  ))

test("feature declaration guardrails tolerate optional roots absent from clean checkouts", () =>
  GuardrailRuntime.runPromise(
    Effect.gen(function* () {
      const found = yield* collectFiles(["missing-template-root"])
      expect(found).toEqual([])
    })
  ))

test("native app composition does not reintroduce method-level selections", () =>
  GuardrailRuntime.runPromise(
    Effect.gen(function* () {
      const capabilities = yield* matchingFiles(/Native\.capabilities/)
      expect(capabilities).toEqual([])
      const methods = yield* matchingFiles(
        new RegExp(`Native\\.(${nativeSurfaces.join("|")})\\.(?:[a-z][A-Za-z0-9_]*)`, "g")
      )
      expect(methods).toEqual([])
    })
  ))
