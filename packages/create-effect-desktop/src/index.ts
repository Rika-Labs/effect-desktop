import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { Data, Effect, FileSystem } from "effect"
import type { PlatformError } from "effect/PlatformError"

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

export class ScaffoldTemplateError extends Data.TaggedError("ScaffoldTemplateError")<{
  readonly template: string
  readonly message: string
}> {}

export class ScaffoldTargetError extends Data.TaggedError("ScaffoldTargetError")<{
  readonly path: string
  readonly message: string
}> {}

export class ScaffoldPackageJsonError extends Data.TaggedError("ScaffoldPackageJsonError")<{
  readonly path: string
  readonly message: string
  readonly cause: unknown
}> {}

export class ScaffoldFileError extends Data.TaggedError("ScaffoldFileError")<{
  readonly operation: string
  readonly path: string
  readonly message: string
  readonly cause: PlatformError
}> {}

export type ScaffoldError =
  | ScaffoldTemplateError
  | ScaffoldTargetError
  | ScaffoldPackageJsonError
  | ScaffoldFileError

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

export const scaffold = (
  options: ScaffoldOptions
): Effect.Effect<ScaffoldResult, ScaffoldError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    if (!isTemplateName(options.template)) {
      return yield* Effect.fail(
        new ScaffoldTemplateError({
          template: String(options.template),
          message: `Unknown template '${String(options.template)}'`
        })
      )
    }

    const root = resolve(templatesRoot())
    const templateSrc = resolve(root, options.template)
    const templateRelativePath = relative(root, templateSrc)

    if (templateRelativePath.startsWith("..") || isAbsolute(templateRelativePath)) {
      return yield* Effect.fail(
        new ScaffoldTemplateError({
          template: options.template,
          message: `Template '${options.template}' escapes the templates directory`
        })
      )
    }

    const templateExists = yield* fs.exists(templateSrc).pipe(mapFileError("exists", templateSrc))
    if (!templateExists) {
      return yield* Effect.fail(
        new ScaffoldTemplateError({
          template: options.template,
          message: `Template '${options.template}' not found at ${templateSrc}`
        })
      )
    }

    const targetExists = yield* fs
      .exists(options.outDir)
      .pipe(mapFileError("exists", options.outDir))
    if (targetExists) {
      const entries = yield* fs
        .readDirectory(options.outDir)
        .pipe(mapFileError("readdir", options.outDir))
      if (entries.length > 0) {
        return yield* Effect.fail(
          new ScaffoldTargetError({
            path: options.outDir,
            message: `Target directory '${options.outDir}' already exists and is not empty`
          })
        )
      }
    }

    yield* fs
      .makeDirectory(options.outDir, { recursive: true })
      .pipe(mapFileError("mkdir", options.outDir))
    yield* copyTemplateTree(fs, templateSrc, options.outDir)

    const pkgPath = join(options.outDir, "package.json")
    const pkgContent = yield* fs.readFileString(pkgPath).pipe(mapFileError("read", pkgPath))
    const pkg = yield* parsePackageJson(pkgPath, pkgContent)

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
    pkg["dependencies"] = deps

    for (const [pkgName, version] of Object.entries(COMPANION_VERSIONS)) {
      const peerDeps = (pkg["peerDependencies"] ?? {}) as Record<string, string>
      peerDeps[pkgName] = version
      pkg["peerDependencies"] = peerDeps
    }

    yield* fs
      .writeFileString(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
      .pipe(mapFileError("write", pkgPath))

    return {
      path: options.outDir,
      template: options.template,
      stubs: TEMPLATE_STUBS[options.template]
    }
  })

const copyTemplateTree = (
  fs: FileSystem.FileSystem,
  source: string,
  target: string
): Effect.Effect<void, ScaffoldError> =>
  Effect.gen(function* () {
    const sourceInfo = yield* fs.stat(source).pipe(mapFileError("stat", source))
    if (sourceInfo.type === "Directory") {
      if (shouldSkipTemplateEntry(basename(source))) {
        return
      }
      yield* fs.makeDirectory(target, { recursive: true }).pipe(mapFileError("mkdir", target))
      const entries = yield* fs.readDirectory(source).pipe(mapFileError("readdir", source))
      for (const entry of entries) {
        yield* copyTemplateTree(fs, join(source, entry), join(target, entry))
      }
      return
    }

    if (sourceInfo.type === "File") {
      yield* fs
        .makeDirectory(dirname(target), { recursive: true })
        .pipe(mapFileError("mkdir", dirname(target)))
      yield* fs.copyFile(source, target).pipe(mapFileError("copy", source))
      return
    }

    return yield* Effect.fail(
      new ScaffoldTargetError({
        path: source,
        message: `Template entry '${source}' is not a regular file or directory`
      })
    )
  })

const shouldSkipTemplateEntry = (name: string): boolean =>
  name === "node_modules" || name === "dist"

const parsePackageJson = (
  path: string,
  content: string
): Effect.Effect<Record<string, unknown>, ScaffoldPackageJsonError> =>
  Effect.try({
    try: () => JSON.parse(content) as Record<string, unknown>,
    catch: (cause) =>
      new ScaffoldPackageJsonError({
        path,
        message: `failed to parse ${path}`,
        cause
      })
  })

const mapFileError =
  (operation: string, path: string) =>
  <A>(effect: Effect.Effect<A, PlatformError>): Effect.Effect<A, ScaffoldFileError> =>
    Effect.mapError(
      effect,
      (cause) =>
        new ScaffoldFileError({
          operation,
          path,
          message: `failed to ${operation} ${path}`,
          cause
        })
    )

const isTemplateName = (value: string): value is TemplateName =>
  TEMPLATE_NAMES.some((template) => template === value)

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
      return { "@effect-desktop/platform-browser": `workspace:^${EFFECT_DESKTOP_VERSION}` }
    case "sqlite-wasm":
      return { "@effect-desktop/platform-browser": `workspace:^${EFFECT_DESKTOP_VERSION}` }
    case "pglite":
      return { "@effect-desktop/platform-browser": `workspace:^${EFFECT_DESKTOP_VERSION}` }
  }
}
