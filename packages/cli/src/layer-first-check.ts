import { access, readdir, readFile } from "node:fs/promises"
import { join, relative, sep } from "node:path"

import { Data, Effect } from "effect"

export type LayerFirstViolationKind =
  | "forbidden-effect-run"
  | "forbidden-runtime-global"
  | "public-promise-api"
  | "public-boundary-without-schema"

export interface LayerFirstCheckOptions {
  readonly cwd: string
  readonly sourceRoots?: readonly string[]
  readonly allowedEdges?: readonly string[]
  readonly publicPromiseAllowlist?: readonly string[]
  readonly publicBoundaryAllowlist?: readonly string[]
}

export interface LayerFirstViolation {
  readonly kind: LayerFirstViolationKind
  readonly path: string
  readonly line: number
  readonly message: string
  readonly symbol?: string
}

export interface LayerFirstCheckReport {
  readonly passed: boolean
  readonly filesScanned: number
  readonly snapshotFilesScanned: number
  readonly violations: readonly LayerFirstViolation[]
}

export class LayerFirstFileError extends Data.TaggedError("LayerFirstFileError")<{
  readonly operation: string
  readonly path: string
  readonly message: string
  readonly cause: unknown
}> {}

export class LayerFirstViolationError extends Data.TaggedError("LayerFirstViolationError")<{
  readonly report: LayerFirstCheckReport
}> {}

export type LayerFirstCheckError = LayerFirstFileError | LayerFirstViolationError

interface PublicApiSnapshotFile {
  readonly packageName?: unknown
  readonly symbols?: unknown
}

interface PublicApiSymbolSnapshot {
  readonly name: string
  readonly signature: string
}

const DEFAULT_SOURCE_ROOTS = ["packages", "apps", "templates", "scripts"] as const

const DEFAULT_ALLOWED_EDGES = [
  "apps/docs/alchemy.run.ts",
  "apps/examples/notes-common/src/index.ts",
  "packages/bridge/src/client.ts",
  "packages/bridge/src/events.ts",
  "packages/bridge/src/handlers.ts",
  "packages/bridge/src/handshake.ts",
  "packages/bridge/src/protocol.ts",
  "packages/bridge/src/streams.ts",
  "packages/bridge/src/window.ts",
  "packages/cli/src/accessibility-gate.ts",
  "packages/cli/src/bin.ts",
  "packages/cli/src/doctor.ts",
  "packages/cli/src/docs-release-gate.ts",
  "packages/cli/src/index.ts",
  "packages/cli/src/layer-first-check.ts",
  "packages/cli/src/notarization-pipeline.ts",
  "packages/cli/src/package-pipeline.ts",
  "packages/cli/src/public-api-snapshot.ts",
  "packages/cli/src/release-gate.ts",
  "packages/cli/src/reproducible-build-check.ts",
  "packages/cli/src/semver-guard.ts",
  "packages/cli/src/signing-pipeline.ts",
  "packages/cli/src/update-manifest.ts",
  "packages/core/src/runtime/approval-broker.ts",
  "packages/core/src/runtime/filesystem.ts",
  "packages/core/src/runtime/host-client.ts",
  "packages/core/src/runtime/main.ts",
  "packages/core/src/runtime/process.ts",
  "packages/core/src/runtime/pty.ts",
  "packages/core/src/runtime/renderer-rpc-client.ts",
  "packages/core/src/runtime/sqlite.ts",
  "packages/core/src/runtime/telemetry.ts",
  "packages/core/src/runtime/window-state.ts",
  "packages/core/src/runtime/worker.ts",
  "packages/core/src/runtime/workflows/backup.ts",
  "packages/devtools/src/reactivity-panel.ts",
  "packages/devtools/src/shell.ts",
  "packages/native/src/crash-reporter.ts",
  "packages/native/src/crash-report-workflow.ts",
  "packages/native/src/global-shortcut.ts",
  "packages/react/src/desktop.tsx",
  "packages/react/src/hooks/desktop.ts",
  "packages/react/src/hooks/stream.ts",
  "packages/react/src/mutation.ts",
  "packages/react/src/permission-approval.ts",
  "packages/solid/src/index.ts",
  "packages/test/src/index.ts",
  "packages/vite/src/child-process.ts",
  "packages/vite/src/virtual-module.ts",
  "packages/vue/src/index.ts",
  "templates/todo-sqlite/src/spine.ts"
] as const

const DEFAULT_PUBLIC_PROMISE_ALLOWLIST = [
  "@effect-desktop/core:createFramedTransport",
  "@effect-desktop/core:FilesystemAdapter",
  "@effect-desktop/core:FramedTransport",
  "@effect-desktop/core:ProcessChild",
  "@effect-desktop/core:PtyChild",
  "@effect-desktop/react:MutationResult",
  "@effect-desktop/react:MutationRunPromise",
  "@effect-desktop/solid:SolidMutation",
  "@effect-desktop/vue:VueMutation"
] as const

const DEFAULT_PUBLIC_BOUNDARY_ALLOWLIST = [
  "@effect-desktop/react:CurrentWindowSetTitleInput",
  "@effect-desktop/react:WindowCloseInput",
  "@effect-desktop/react:WindowSetTitleInput"
] as const

const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const
const GENERATED_SEGMENTS = new Set(["dist", ".next", ".astro", ".source", "node_modules"])
const BOUNDARY_SUFFIX_PATTERN = /(Input|Output|Payload|Event|Result|Options|Config)$/u

export const runLayerFirstCheck = (
  options: LayerFirstCheckOptions
): Effect.Effect<LayerFirstCheckReport, LayerFirstCheckError, never> =>
  Effect.gen(function* () {
    const sourceRoots = options.sourceRoots ?? DEFAULT_SOURCE_ROOTS
    const allowedEdges = new Set(options.allowedEdges ?? DEFAULT_ALLOWED_EDGES)
    const promiseAllowlist = new Set(
      options.publicPromiseAllowlist ?? DEFAULT_PUBLIC_PROMISE_ALLOWLIST
    )
    const boundaryAllowlist = new Set(
      options.publicBoundaryAllowlist ?? DEFAULT_PUBLIC_BOUNDARY_ALLOWLIST
    )
    const files = yield* discoverSourceFiles(options.cwd, sourceRoots)
    const violations: LayerFirstViolation[] = []

    for (const path of files) {
      const text = yield* readText(path)
      const relativePath = toRepoPath(options.cwd, path)
      const isAllowedEdge = allowedEdges.has(relativePath)
      violations.push(...scanSourceFile(relativePath, text, isAllowedEdge, boundaryAllowlist))
    }

    const snapshotFiles = yield* discoverSnapshotFiles(options.cwd)
    for (const path of snapshotFiles) {
      const text = yield* readText(path)
      const relativePath = toRepoPath(options.cwd, path)
      violations.push(...scanPublicApiSnapshot(relativePath, text, promiseAllowlist))
    }

    const report: LayerFirstCheckReport = {
      passed: violations.length === 0,
      filesScanned: files.length,
      snapshotFilesScanned: snapshotFiles.length,
      violations
    }

    return report.passed ? report : yield* Effect.fail(new LayerFirstViolationError({ report }))
  })

export const formatLayerFirstReport = (report: LayerFirstCheckReport): string => {
  const lines = [
    "Effect Desktop Layer-first check",
    `status            ${report.passed ? "passed" : "failed"}`,
    `files             ${report.filesScanned}`,
    `api snapshots     ${report.snapshotFilesScanned}`,
    `violations        ${report.violations.length}`
  ]

  if (report.violations.length > 0) {
    lines.push("", "Violations:")
    for (const violation of report.violations) {
      lines.push(formatViolation(violation))
    }
  }

  lines.push("")
  return lines.join("\n")
}

export const formatLayerFirstError = (
  error: LayerFirstCheckError
): {
  readonly tag: string
  readonly message: string
  readonly report?: LayerFirstCheckReport
} => {
  if (error instanceof LayerFirstViolationError) {
    return {
      tag: error._tag,
      message: `${error.report.violations.length} Layer-first violation(s) detected`,
      report: error.report
    }
  }
  return { tag: error._tag, message: error.message }
}

const scanSourceFile = (
  path: string,
  text: string,
  isAllowedEdge: boolean,
  boundaryAllowlist: ReadonlySet<string>
): readonly LayerFirstViolation[] => {
  const violations: LayerFirstViolation[] = []
  if (!isAllowedEdge) {
    violations.push(...scanForbiddenPatterns(path, text))
  }
  violations.push(...scanPublicBoundaryClasses(path, text, boundaryAllowlist))
  violations.push(...scanPublicPromiseSource(path, text))
  return violations
}

const scanForbiddenPatterns = (path: string, text: string): readonly LayerFirstViolation[] => {
  const violations: LayerFirstViolation[] = []
  const lines = text.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    const lineNumber = index + 1
    if (/\bEffect\.run[A-Za-z0-9_]*/u.test(line)) {
      violations.push({
        kind: "forbidden-effect-run",
        path,
        line: lineNumber,
        message: "Effect.run* belongs at composition edges, not library internals."
      })
    }
    if (
      /\bprocess\.env\b/u.test(line) ||
      /\bBun\.env\b/u.test(line) ||
      /\bDate\.now\s*\(/u.test(line) ||
      /\bMath\.random\s*\(/u.test(line) ||
      /\b(?:globalThis\.)?crypto\.randomUUID\s*\(/u.test(line) ||
      /from\s+["']node:fs(?:\/promises)?["']/u.test(line)
    ) {
      violations.push({
        kind: "forbidden-runtime-global",
        path,
        line: lineNumber,
        message: "Runtime globals and host adapters must enter through services or edge files."
      })
    }
  }
  return violations
}

const scanPublicPromiseSource = (path: string, text: string): readonly LayerFirstViolation[] => {
  if (!path.endsWith("/src/index.ts") && !path.endsWith("/src/index.tsx")) {
    return []
  }
  const violations: LayerFirstViolation[] = []
  const lines = text.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    if (/\bexport\b/u.test(line) && /\bPromise\s*</u.test(line)) {
      violations.push({
        kind: "public-promise-api",
        path,
        line: index + 1,
        message: "Public effectful APIs should return Effect.Effect<A, E, R>, not Promise<A>."
      })
    }
  }
  return violations
}

const scanPublicBoundaryClasses = (
  path: string,
  text: string,
  allowlist: ReadonlySet<string>
): readonly LayerFirstViolation[] => {
  const packageName = packageNameFromPath(path)
  if (packageName === undefined) {
    return []
  }
  const violations: LayerFirstViolation[] = []
  const classPattern = /export\s+class\s+([A-Za-z0-9_]+)([^{]*)\{/gu
  for (const match of text.matchAll(classPattern)) {
    const name = match[1]
    const heritage = match[2] ?? ""
    if (name === undefined || !BOUNDARY_SUFFIX_PATTERN.test(name)) {
      continue
    }
    const symbol = `${packageName}:${name}`
    if (allowlist.has(symbol)) {
      continue
    }
    if (heritage.includes("Data.TaggedError")) {
      continue
    }
    if (!heritage.includes("Schema.Class")) {
      violations.push({
        kind: "public-boundary-without-schema",
        path,
        line: lineForOffset(text, match.index ?? 0),
        symbol,
        message: "Public boundary classes must extend Schema.Class."
      })
    }
  }
  return violations
}

const scanPublicApiSnapshot = (
  path: string,
  text: string,
  allowlist: ReadonlySet<string>
): readonly LayerFirstViolation[] => {
  const snapshot = parseSnapshot(text)
  if (snapshot === undefined || typeof snapshot.packageName !== "string") {
    return []
  }
  const symbols = Array.isArray(snapshot.symbols) ? snapshot.symbols : []
  const violations: LayerFirstViolation[] = []
  for (const symbol of symbols) {
    if (!isPublicApiSymbolSnapshot(symbol)) {
      continue
    }
    const key = `${snapshot.packageName}:${symbol.name}`
    if (allowlist.has(key)) {
      continue
    }
    if (symbol.signature.includes("Promise<")) {
      violations.push({
        kind: "public-promise-api",
        path,
        line: 1,
        symbol: key,
        message:
          "Public API snapshot exposes Promise; use Effect.Effect or add an explicit edge allowlist."
      })
    }
  }
  return violations
}

const parseSnapshot = (text: string): PublicApiSnapshotFile | undefined => {
  try {
    return JSON.parse(text) as PublicApiSnapshotFile
  } catch {
    return undefined
  }
}

const isPublicApiSymbolSnapshot = (value: unknown): value is PublicApiSymbolSnapshot =>
  isRecord(value) && typeof value["name"] === "string" && typeof value["signature"] === "string"

const discoverSourceFiles = (
  cwd: string,
  roots: readonly string[]
): Effect.Effect<readonly string[], LayerFirstFileError, never> =>
  Effect.gen(function* () {
    const files: string[] = []
    for (const root of roots) {
      const absoluteRoot = join(cwd, root)
      if (yield* fileExists(absoluteRoot)) {
        files.push(...(yield* walkSourceFiles(absoluteRoot)))
      }
    }
    return files.sort()
  })

const discoverSnapshotFiles = (
  cwd: string
): Effect.Effect<readonly string[], LayerFirstFileError, never> =>
  Effect.gen(function* () {
    const root = join(cwd, "api", "snapshots")
    return (yield* fileExists(root)) ? yield* walkSnapshotFiles(root) : []
  })

const walkSourceFiles = (
  root: string
): Effect.Effect<readonly string[], LayerFirstFileError, never> =>
  Effect.gen(function* () {
    const files: string[] = []
    const entries = yield* readDirectory(root)
    for (const entry of entries) {
      const path = join(root, entry.name)
      if (entry.isDirectory()) {
        if (!GENERATED_SEGMENTS.has(entry.name)) {
          files.push(...(yield* walkSourceFiles(path)))
        }
      } else if (isSourceFile(path) && !isTestFile(path) && !path.endsWith(".d.ts")) {
        files.push(path)
      }
    }
    return files
  })

const walkSnapshotFiles = (
  root: string
): Effect.Effect<readonly string[], LayerFirstFileError, never> =>
  Effect.gen(function* () {
    const files: string[] = []
    const entries = yield* readDirectory(root)
    for (const entry of entries) {
      const path = join(root, entry.name)
      if (entry.isDirectory()) {
        files.push(...(yield* walkSnapshotFiles(path)))
      } else if (path.endsWith(".snapshot.json")) {
        files.push(path)
      }
    }
    return files.sort()
  })

const readDirectory = (
  path: string
): Effect.Effect<
  readonly { readonly name: string; readonly isDirectory: () => boolean }[],
  LayerFirstFileError,
  never
> =>
  Effect.tryPromise({
    try: () => readdir(path, { withFileTypes: true }),
    catch: (cause) =>
      new LayerFirstFileError({
        operation: "readdir",
        path,
        message: `failed to read directory ${path}`,
        cause
      })
  })

const readText = (path: string): Effect.Effect<string, LayerFirstFileError, never> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) =>
      new LayerFirstFileError({
        operation: "readFile",
        path,
        message: `failed to read file ${path}`,
        cause
      })
  })

const fileExists = (path: string): Effect.Effect<boolean, never, never> =>
  Effect.tryPromise({
    try: () => access(path),
    catch: () => undefined
  }).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false))
  )

const isSourceFile = (path: string): boolean =>
  SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension))

const isTestFile = (path: string): boolean =>
  path.endsWith(".test.ts") || path.endsWith(".test.tsx") || path.includes(`${sep}__tests__${sep}`)

const toRepoPath = (cwd: string, path: string): string => relative(cwd, path).replaceAll("\\", "/")

const lineForOffset = (text: string, offset: number): number =>
  text.slice(0, offset).split(/\r?\n/u).length

const packageNameFromPath = (path: string): string | undefined => {
  const parts = path.split("/")
  const packageIndex = parts.indexOf("packages")
  if (packageIndex >= 0) {
    const name = parts[packageIndex + 1]
    return name === undefined ? undefined : `@effect-desktop/${name}`
  }
  const templateIndex = parts.indexOf("templates")
  if (templateIndex >= 0) {
    const name = parts[templateIndex + 1]
    return name === undefined ? undefined : `@effect-desktop/template-${name}`
  }
  return undefined
}

const formatViolation = (violation: LayerFirstViolation): string => {
  const symbol = violation.symbol === undefined ? "" : ` ${violation.symbol}`
  return `- ${violation.kind}${symbol} at ${violation.path}:${violation.line}: ${violation.message}`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
