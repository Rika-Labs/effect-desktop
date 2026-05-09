import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export type TemplateName = "basic-react-tailwind" | "todo-sqlite" | "multi-window"
export type RendererStorage = "none" | "indexeddb" | "sqlite-wasm" | "pglite"

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

  mkdirSync(options.outDir, { recursive: true })

  cpSync(templateSrc, options.outDir, {
    recursive: true,
    filter: (src) => !src.includes("node_modules") && !src.includes("dist")
  })

  const pkgPath = join(options.outDir, "package.json")
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>

  pkg["name"] = options.name

  const deps = (pkg["dependencies"] ?? {}) as Record<string, string>
  deps["effect"] = EFFECT_VERSION

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
