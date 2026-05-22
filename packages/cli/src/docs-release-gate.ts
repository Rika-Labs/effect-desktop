import { isAbsolute, join, relative } from "node:path"

import { DesktopTimeouts } from "@orika/core"
import { Data, Duration, Effect, Option, Schema } from "effect"

import { ReleaseFileSystem, runReleaseFileSystem } from "./release-file-system.js"
import { runReleaseTool } from "./release-tool-runner.js"

export interface DocsReleaseGateOptions {
  readonly cwd: string
  readonly commandRunner?: DocsExampleRunner
  readonly exampleTimeoutMillis?: number
}

export interface DocsExampleInvocation {
  readonly file: string
  readonly blockIndex: number
  readonly code: string
  readonly cwd: string
}

export type DocsExampleRunner = (
  invocation: DocsExampleInvocation
) => Effect.Effect<void, DocsGateExampleFailedError | DocsGateFileError, never>

export interface DocsManifest {
  readonly schemaVersion: 1
  readonly source: string
  readonly pages: readonly DocsManifestPage[]
}

export interface DocsManifestPage {
  readonly id: string
  readonly title: string
  readonly path: string
}

const DocsManifestPageJson = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  path: Schema.String
})

const DocsManifestJson = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  source: Schema.String,
  pages: Schema.Array(DocsManifestPageJson)
})

export interface DocsExampleReport {
  readonly file: string
  readonly blockIndex: number
}

export interface DocsPageReport {
  readonly id: string
  readonly title: string
  readonly path: string
  readonly runnableExamples: number
}

export interface DocsReleaseGateReport {
  readonly passed: boolean
  readonly pages: readonly DocsPageReport[]
  readonly examples: readonly DocsExampleReport[]
}

export class DocsGateFileError extends Data.TaggedError("DocsGateFileError")<{
  readonly operation: string
  readonly path: string
  readonly message: string
  readonly cause: unknown
}> {}

export class DocsGateManifestError extends Data.TaggedError("DocsGateManifestError")<{
  readonly message: string
}> {}

export class DocsGateMissingPageError extends Data.TaggedError("DocsGateMissingPageError")<{
  readonly page: DocsManifestPage
  readonly message: string
}> {}

export class DocsGateExampleFailedError extends Data.TaggedError("DocsGateExampleFailedError")<{
  readonly file: string
  readonly blockIndex: number
  readonly message: string
  readonly exitCode?: number
  readonly stderr?: string
  readonly cause?: unknown
}> {}

export class DocsGateCoverageError extends Data.TaggedError("DocsGateCoverageError")<{
  readonly page: DocsManifestPage
  readonly expectedTokens: readonly string[]
  readonly message: string
}> {}

export type DocsReleaseGateError =
  | DocsGateFileError
  | DocsGateManifestError
  | DocsGateMissingPageError
  | DocsGateExampleFailedError
  | DocsGateCoverageError

interface RunnableBlock {
  readonly file: string
  readonly blockIndex: number
  readonly code: string
}

const MANIFEST_PATH = "docs/docs-manifest.json"
const RUNNABLE_BLOCK_PATTERN = /```([^\n`]*)\n([\s\S]*?)```/g
const SPEC_SOURCE = "engineering/SPEC.md §25.3"
const REQUIRED_SPEC_PAGES: ReadonlyMap<string, string> = new Map([
  ["installation", "docs/installation.md"],
  ["quickstart", "docs/quickstart.md"],
  ["concepts", "docs/concepts.md"],
  ["architecture-overview", "docs/architecture-overview.md"],
  ["app-config", "docs/app-config.md"],
  ["windows", "docs/windows.md"],
  ["typed-apis", "docs/typed-apis.md"],
  ["bridge", "docs/bridge.md"],
  ["native-services", "docs/native-services.md"],
  ["resources", "docs/resources.md"],
  ["processes", "docs/processes.md"],
  ["ptys", "docs/ptys.md"],
  ["filesystem", "docs/filesystem.md"],
  ["storage", "docs/storage.md"],
  ["permissions", "docs/permissions.md"],
  ["commands", "docs/commands.md"],
  ["devtools", "docs/devtools.md"],
  ["testing", "docs/testing.md"],
  ["packaging", "docs/packaging.md"],
  ["signing", "docs/signing.md"],
  ["updating", "docs/updating.md"],
  ["troubleshooting", "docs/troubleshooting.md"],
  ["contribution-guide", "docs/contribution-guide.md"]
])
const REQUIRED_PAGE_COVERAGE_TOKENS: ReadonlyMap<string, readonly string[]> = new Map([
  ["installation", ["runCli", "desktop --help"]],
  ["quickstart", ["ReactDesktop", "WindowRpcs"]],
  ["concepts", ["Desktop", "HostProtocolEnvelope"]],
  ["architecture-overview", ["HostProtocolRequestEnvelope", "Desktop"]],
  ["app-config", ["defineDesktopConfig"]],
  ["windows", ["WindowRpcs", "WindowMethodNames"]],
  ["typed-apis", ["RpcGroup", "makeDesktopRpcHandlerRuntime"]],
  ["bridge", ["HostProtocolEnvelope", "Client"]],
  ["native-services", ["ClipboardRpcs", "DialogRpcs", "WindowRpcs"]],
  ["resources", ["ResourceRegistry", "ManagedResource"]],
  ["processes", ["Process", "MockProcess"]],
  ["ptys", ["PTY", "MockPTY"]],
  ["filesystem", ["MemoryFilesystem", "Filesystem"]],
  ["storage", ["MemorySecretsSafeStorage", "Settings"]],
  ["permissions", ["PermissionRegistry", "PermissionApprovalWorkflow"]],
  ["commands", ["CommandRegistry", "CommandsDevtools"]],
  ["devtools", ["DevtoolsShell", "DevtoolsSnapshotClient"]],
  ["testing", ["runHeadless", "MockBridge"]],
  ["packaging", ["runDesktopPackage", "desktop package"]],
  ["signing", ["runDesktopSign", "desktop sign"]],
  ["updating", ["runDesktopPublish", "UpdateManifest"]],
  ["troubleshooting", ["DoctorMissing", "runDesktopDoctor"]],
  ["contribution-guide", ["check --docs", "runDocsReleaseGate"]]
])

export const runDocsReleaseGate = (
  options: DocsReleaseGateOptions
): Effect.Effect<DocsReleaseGateReport, DocsReleaseGateError, never> =>
  Effect.gen(function* () {
    const manifest = yield* readDocsManifest(join(options.cwd, MANIFEST_PATH))
    yield* validateManifest(manifest)

    const pageReports: DocsPageReport[] = []
    const examples: DocsExampleReport[] = []
    const runner = options.commandRunner ?? runDocsExample
    const exampleTimeoutMillis = options.exampleTimeoutMillis ?? DesktopTimeouts.docsExampleMillis

    for (const page of manifest.pages) {
      const absolutePath = join(options.cwd, page.path)
      if (
        isAbsolute(page.path) ||
        relative(options.cwd, absolutePath).startsWith("..") ||
        page.path.includes("..")
      ) {
        return yield* Effect.fail(
          new DocsGateManifestError({
            message: `docs manifest page path ${page.path} escapes the repo`
          })
        )
      }
      const body = yield* readText(absolutePath).pipe(
        Effect.mapError(
          (error) =>
            new DocsGateMissingPageError({
              page,
              message: `required docs page ${page.path} is missing or unreadable: ${error.message}`
            })
        )
      )
      if (body.trim().length === 0) {
        return yield* Effect.fail(
          new DocsGateMissingPageError({
            page,
            message: `required docs page ${page.path} is empty`
          })
        )
      }

      const blocks = extractRunnableBlocks(page.path, body)
      if (manifest.source === SPEC_SOURCE) {
        yield* validateRequiredPageCoverage(page, blocks)
      }
      for (const block of blocks) {
        yield* runDocsExampleWithTimeout(
          runner,
          { ...block, cwd: options.cwd },
          exampleTimeoutMillis
        )
        examples.push({ file: block.file, blockIndex: block.blockIndex })
      }
      pageReports.push({
        id: page.id,
        title: page.title,
        path: page.path,
        runnableExamples: blocks.length
      })
    }

    return {
      passed: true,
      pages: pageReports,
      examples
    }
  })

export const formatDocsReleaseGateReport = (report: DocsReleaseGateReport): string =>
  [
    "ORIKA docs",
    `status            ${report.passed ? "passed" : "failed"}`,
    `pages             ${report.pages.length}`,
    `examples          ${report.examples.length}`,
    ...report.pages.map((page) => `${page.id.padEnd(24)} ${page.runnableExamples} examples`),
    ""
  ].join("\n")

export const formatDocsReleaseGateError = (
  error: DocsReleaseGateError
): { readonly tag: string; readonly message: string } => ({
  tag: error._tag,
  message: error.message
})

const validateManifest = (
  manifest: DocsManifest
): Effect.Effect<void, DocsGateManifestError, never> => {
  if (manifest.schemaVersion !== 1) {
    return Effect.fail(
      new DocsGateManifestError({ message: "docs manifest schemaVersion must be 1" })
    )
  }
  const ids = new Set<string>()
  const paths = new Set<string>()
  for (const page of manifest.pages) {
    if (page.id.length === 0 || page.title.length === 0 || page.path.length === 0) {
      return Effect.fail(new DocsGateManifestError({ message: "docs manifest rows must be named" }))
    }
    if (ids.has(page.id)) {
      return Effect.fail(new DocsGateManifestError({ message: `duplicate docs id ${page.id}` }))
    }
    if (paths.has(page.path)) {
      return Effect.fail(new DocsGateManifestError({ message: `duplicate docs path ${page.path}` }))
    }
    ids.add(page.id)
    paths.add(page.path)
  }
  if (manifest.source === SPEC_SOURCE) {
    const required = validateRequiredSpecPages(manifest.pages)
    if (required !== undefined) {
      return Effect.fail(new DocsGateManifestError({ message: required }))
    }
  }
  return Effect.void
}

const validateRequiredSpecPages = (pages: readonly DocsManifestPage[]): string | undefined => {
  if (pages.length !== REQUIRED_SPEC_PAGES.size) {
    return `docs manifest must declare exactly ${REQUIRED_SPEC_PAGES.size} §25.3 pages`
  }
  const actual = new Map(pages.map((page) => [page.id, page.path]))
  for (const [id, path] of REQUIRED_SPEC_PAGES) {
    if (actual.get(id) !== path) {
      return `docs manifest is missing required §25.3 page ${id} at ${path}`
    }
  }
  return undefined
}

const validateRequiredPageCoverage = (
  page: DocsManifestPage,
  blocks: readonly RunnableBlock[]
): Effect.Effect<void, DocsGateCoverageError, never> => {
  const expectedTokens = REQUIRED_PAGE_COVERAGE_TOKENS.get(page.id)
  if (expectedTokens === undefined) {
    return Effect.void
  }
  if (blocks.some((block) => expectedTokens.some((token) => block.code.includes(token)))) {
    return Effect.void
  }
  return Effect.fail(
    new DocsGateCoverageError({
      page,
      expectedTokens,
      message: `required docs page ${page.path} has no runnable example covering ${expectedTokens.join(" or ")}`
    })
  )
}

const extractRunnableBlocks = (file: string, body: string): readonly RunnableBlock[] => {
  const blocks: RunnableBlock[] = []
  let blockIndex = 0
  for (const match of body.matchAll(RUNNABLE_BLOCK_PATTERN)) {
    blockIndex += 1
    const info = match[1] ?? ""
    const code = match[2] ?? ""
    const tags = new Set(info.split(/\s+/).filter((tag) => tag.length > 0))
    if (tags.has("run")) {
      blocks.push({ file, blockIndex, code })
    }
  }
  return blocks
}

const runDocsExampleWithTimeout = (
  runner: DocsExampleRunner,
  invocation: DocsExampleInvocation,
  timeoutMillis: number
): Effect.Effect<void, DocsGateExampleFailedError | DocsGateFileError, never> =>
  Effect.gen(function* () {
    const result = yield* runner(invocation).pipe(
      Effect.timeoutOption(Duration.millis(timeoutMillis))
    )
    if (Option.isSome(result)) {
      return result.value
    }
    return yield* Effect.fail(
      new DocsGateExampleFailedError({
        file: invocation.file,
        blockIndex: invocation.blockIndex,
        message: `docs example ${invocation.file}#${invocation.blockIndex} timed out after ${timeoutMillis}ms`
      })
    )
  })

const runDocsExample: DocsExampleRunner = (invocation) =>
  Effect.gen(function* () {
    const directory = yield* makeTempDirectory(invocation.cwd)
    const effect = Effect.gen(function* () {
      const file = join(directory, `docs-example-${invocation.blockIndex}.ts`)
      yield* writeText(file, invocation.code)
      const result = yield* runReleaseTool({
        step: `docs-example-${invocation.blockIndex}`,
        command: "bun",
        args: [file],
        cwd: invocation.cwd,
        stdout: "ignore",
        stderr: "pipe"
      }).pipe(
        Effect.mapError(
          (cause) =>
            new DocsGateExampleFailedError({
              file: invocation.file,
              blockIndex: invocation.blockIndex,
              message: `failed to start docs example ${invocation.file}#${invocation.blockIndex}`,
              cause
            })
        )
      )
      if (result.exitCode !== 0) {
        return yield* Effect.fail(
          new DocsGateExampleFailedError({
            file: invocation.file,
            blockIndex: invocation.blockIndex,
            message: `docs example ${invocation.file}#${invocation.blockIndex} exited with ${result.exitCode}`,
            exitCode: result.exitCode,
            stderr: result.stderr
          })
        )
      }
    })
    yield* effect.pipe(Effect.ensuring(removePath(directory).pipe(Effect.ignore)))
  })

const readDocsManifest = (path: string): Effect.Effect<DocsManifest, DocsGateFileError, never> =>
  Effect.gen(function* () {
    const body = yield* readText(path)
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(DocsManifestJson))(body).pipe(
      Effect.mapError(
        (cause) =>
          new DocsGateFileError({
            operation: "parse",
            path,
            message: `failed to parse ${path}`,
            cause
          })
      )
    )
  })

const readText = (path: string): Effect.Effect<string, DocsGateFileError, never> =>
  runReleaseFileSystem(
    Effect.gen(function* () {
      const fs = yield* ReleaseFileSystem
      return yield* fs.readFileString(path)
    })
  ).pipe(
    Effect.mapError(
      (cause) =>
        new DocsGateFileError({
          operation: "read",
          path,
          message: `failed to read ${path}`,
          cause
        })
    )
  )

const writeText = (path: string, text: string): Effect.Effect<void, DocsGateFileError, never> =>
  runReleaseFileSystem(
    Effect.gen(function* () {
      const fs = yield* ReleaseFileSystem
      yield* fs.writeFileString(path, text)
    })
  ).pipe(
    Effect.mapError(
      (cause) =>
        new DocsGateFileError({
          operation: "write",
          path,
          message: `failed to write ${path}`,
          cause
        })
    )
  )

const makeTempDirectory = (cwd: string): Effect.Effect<string, DocsGateFileError, never> =>
  runReleaseFileSystem(
    Effect.gen(function* () {
      const fs = yield* ReleaseFileSystem
      return yield* fs.makeTempDirectory({ directory: cwd, prefix: ".docs-examples-" })
    })
  ).pipe(
    Effect.mapError(
      (cause) =>
        new DocsGateFileError({
          operation: "mkdtemp",
          path: cwd,
          message: "failed to create docs example temp directory",
          cause
        })
    )
  )

const removePath = (path: string): Effect.Effect<void, DocsGateFileError, never> =>
  runReleaseFileSystem(
    Effect.gen(function* () {
      const fs = yield* ReleaseFileSystem
      yield* fs.remove(path)
    })
  ).pipe(
    Effect.mapError(
      (cause) =>
        new DocsGateFileError({
          operation: "rm",
          path,
          message: `failed to remove ${path}`,
          cause
        })
    )
  )

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null

export const readDocsManifestPageIds = (value: unknown): readonly string[] =>
  isRecord(value) && Array.isArray(value["pages"])
    ? value["pages"].flatMap((page) =>
        isRecord(page) && typeof page["id"] === "string" ? [page["id"]] : []
      )
    : []
