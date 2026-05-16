import { expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const repoRoot = join(import.meta.dir, "../../..")
const searchedRoots = ["apps", "docs", "packages", "templates"]
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
  "Shell",
  "SystemAppearance",
  "Tray",
  "Updater",
  "WebView",
  "Window"
] as const

const files = (roots: readonly string[] = searchedRoots): readonly string[] => {
  const found: string[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      if (ignoredDirectories.has(entry)) {
        continue
      }
      const path = join(directory, entry)
      const stat = statSync(path)
      if (stat.isDirectory()) {
        visit(path)
        continue
      }
      const extension = entry.slice(entry.lastIndexOf("."))
      if (textExtensions.has(extension)) {
        found.push(path)
      }
    }
  }

  for (const root of roots) {
    const path = join(repoRoot, root)
    if (existsSync(path)) {
      visit(path)
    }
  }
  return found
}

const matchingFiles = (pattern: RegExp): readonly string[] =>
  files()
    .filter((file) => file !== import.meta.path)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => relative(repoRoot, file))

test("feature declarations do not reintroduce declaration registries or snapshots", () => {
  expect(
    matchingFiles(
      /snapshotDeclarationLayerSync|Desktop(?:Rpc|Native|Permission|Workflow|Window|Provider)Registry/
    )
  ).toEqual([])
})

test("feature declaration guardrails tolerate optional roots absent from clean checkouts", () => {
  expect(files(["missing-template-root"])).toEqual([])
})

test("native app composition does not reintroduce method-level selections", () => {
  expect(matchingFiles(/Native\.capabilities/)).toEqual([])
  expect(
    matchingFiles(
      new RegExp(`Native\\.(${nativeSurfaces.join("|")})\\.(?:[a-z][A-Za-z0-9_]*)`, "g")
    )
  ).toEqual([])
})
