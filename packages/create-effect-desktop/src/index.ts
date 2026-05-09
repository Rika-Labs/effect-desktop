import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const TEMPLATE_NAMES = ["basic-react-tailwind", "todo-sqlite", "multi-window"] as const
export type TemplateName = (typeof TEMPLATE_NAMES)[number]

export const RENDERER_STORAGE_KINDS = ["none", "indexeddb", "sqlite-wasm", "pglite"] as const
export type RendererStorage = (typeof RENDERER_STORAGE_KINDS)[number]

export interface ScaffoldOptions {
  readonly name: string
  readonly template: TemplateName
  readonly rendererStorage: RendererStorage
  readonly includeWorkflows: boolean
  readonly includeCluster: boolean
  readonly outDir: string
}

export interface ScaffoldResult {
  readonly path: string
  readonly template: TemplateName
  readonly stubs: readonly string[]
}

const EFFECT_VERSION = "4.0.0-beta.60"
const EFFECT_DESKTOP_VERSION = "0.0.0"

const COMPANION_VERSIONS: Record<string, string> = {
  "@effect/platform": EFFECT_VERSION,
  "@effect/platform-bun": EFFECT_VERSION,
  "@effect/sql": EFFECT_VERSION,
  "@effect/sql-sqlite-bun": EFFECT_VERSION
}

const TEMPLATE_STUBS: Record<TemplateName, readonly string[]> = {
  "basic-react-tailwind": [],
  "todo-sqlite": [],
  "multi-window": [
    "multi-window requires T29 (cluster) which has not merged; cluster wiring is stubbed"
  ]
}

const templatesRoot = (): string => {
  const thisFile = fileURLToPath(import.meta.url)
  return join(thisFile, "..", "..", "..", "..", "templates")
}

export const scaffold = (options: ScaffoldOptions): ScaffoldResult => {
  const templateSrc = join(templatesRoot(), options.template)

  if (!existsSync(templateSrc)) {
    throw new Error(`Template '${options.template}' not found at ${templateSrc}`)
  }

  if (existsSync(options.outDir) && readdirSync(options.outDir).length > 0) {
    throw new Error(`Target directory '${options.outDir}' already exists and is not empty`)
  }

  mkdirSync(options.outDir, { recursive: true })

  cpSync(templateSrc, options.outDir, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (src) => !src.includes("node_modules") && !src.includes("dist")
  })

  const pkgPath = join(options.outDir, "package.json")
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>

  pkg["name"] = options.name

  const deps = (pkg["dependencies"] ?? {}) as Record<string, string>
  deps["effect"] = EFFECT_VERSION
  rewriteWorkspaceDependencies(deps)

  if (options.rendererStorage !== "none") {
    Object.assign(deps, rendererStorageDeps(options.rendererStorage))
  }
  if (options.includeWorkflows) {
    Object.assign(deps, COMPANION_VERSIONS)
  }
  if (options.includeCluster) {
    deps["@effect/cluster"] = EFFECT_VERSION
  }

  pkg["dependencies"] = deps

  for (const [pkg_, version] of Object.entries(COMPANION_VERSIONS)) {
    const peerDeps = (pkg["peerDependencies"] ?? {}) as Record<string, string>
    peerDeps[pkg_] = version
    pkg["peerDependencies"] = peerDeps
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")

  return {
    path: options.outDir,
    template: options.template,
    stubs: TEMPLATE_STUBS[options.template]
  }
}

const rewriteWorkspaceDependencies = (dependencies: Record<string, string>): void => {
  for (const [name, version] of Object.entries(dependencies)) {
    if (name.startsWith("@effect-desktop/") && version.startsWith("workspace:")) {
      dependencies[name] = EFFECT_DESKTOP_VERSION
    }
  }
}

const rendererStorageDeps = (storage: RendererStorage): Record<string, string> => {
  switch (storage) {
    case "none":
      return {}
    case "indexeddb":
      return { "@effect/platform-browser": EFFECT_VERSION }
    case "sqlite-wasm":
      return {
        "@effect/platform-browser": EFFECT_VERSION,
        "@effect/sql-sqlite-wasm": EFFECT_VERSION
      }
    case "pglite":
      return {
        "@effect/platform-browser": EFFECT_VERSION,
        "@effect/sql-pglite": EFFECT_VERSION
      }
  }
}
