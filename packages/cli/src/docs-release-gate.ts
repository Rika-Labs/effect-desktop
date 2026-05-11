import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative } from "node:path"

import { Data, Effect, Option } from "effect"

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
const SPEC_SOURCE = "docs/SPEC.md §25.3"
const DEFAULT_EXAMPLE_TIMEOUT_MILLIS = 10_000
const REQUIRED_SPEC_PAGES: ReadonlyMap<string, string> = new Map([
  ["installation", "docs/user/installation.md"],
  ["quickstart", "docs/user/quickstart.md"],
  ["concepts", "docs/user/concepts.md"],
  ["architecture-overview", "docs/user/architecture-overview.md"],
  ["app-config", "docs/user/app-config.md"],
  ["windows", "docs/user/windows.md"],
  ["typed-apis", "docs/user/typed-apis.md"],
  ["bridge", "docs/user/bridge.md"],
  ["native-services", "docs/user/native-services.md"],
  ["resources", "docs/user/resources.md"],
  ["processes", "docs/user/processes.md"],
  ["ptys", "docs/user/ptys.md"],
  ["filesystem", "docs/user/filesystem.md"],
  ["storage", "docs/user/storage.md"],
  ["permissions", "docs/user/permissions.md"],
  ["commands", "docs/user/commands.md"],
  ["devtools", "docs/user/devtools.md"],
  ["testing", "docs/user/testing.md"],
  ["packaging", "docs/user/packaging.md"],
  ["signing", "docs/user/signing.md"],
  ["updating", "docs/user/updating.md"],
  ["troubleshooting", "docs/user/troubleshooting.md"],
  ["contribution-guide", "docs/user/contribution-guide.md"]
])
const REQUIRED_PAGE_COVERAGE_TOKENS: ReadonlyMap<string, readonly string[]> = new Map([
  ["installation", ["runCli", "desktop --help"]],
  ["quickstart", ["ReactDesktop", "WindowRpcs"]],
  ["concepts", ["Desktop", "HostProtocolEnvelope"]],
  ["architecture-overview", ["HostProtocolRequestEnvelope", "Desktop"]],
  ["app-config", ["defineDesktopConfig"]],
  ["windows", ["WindowRpcs", "WindowMethodNames"]],
  ["typed-apis", ["RpcGroup", "Handlers"]],
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
    const manifest = yield* readJson(join(options.cwd, MANIFEST_PATH)).pipe(
      Effect.flatMap(parseDocsManifest)
    )
    yield* validateManifest(manifest)

    const pageReports: DocsPageReport[] = []
    const examples: DocsExampleReport[] = []
    const runner = options.commandRunner ?? runDocsExample
    const exampleTimeoutMillis = options.exampleTimeoutMillis ?? DEFAULT_EXAMPLE_TIMEOUT_MILLIS

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
        Effect.catch((error) =>
          Effect.fail(
            new DocsGateMissingPageError({
              page,
              message: `required docs page ${page.path} is missing or unreadable: ${error.message}`
            })
          )
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
    "Effect Desktop docs",
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

const parseDocsManifest = (
  value: unknown
): Effect.Effect<DocsManifest, DocsGateManifestError, never> => {
  if (!isManifestRecord(value)) {
    return Effect.fail(
      new DocsGateManifestError({ message: "docs manifest must be a JSON object" })
    )
  }
  const schemaVersion = value["schemaVersion"]
  if (typeof schemaVersion !== "number") {
    return Effect.fail(
      new DocsGateManifestError({ message: "docs schemaVersion must be a number" })
    )
  }
  if (schemaVersion !== 1) {
    return Effect.fail(
      new DocsGateManifestError({ message: "docs manifest schemaVersion must be 1" })
    )
  }
  if (typeof value["source"] !== "string") {
    return Effect.fail(
      new DocsGateManifestError({ message: "docs manifest source must be a string" })
    )
  }
  if (!Array.isArray(value["pages"])) {
    return Effect.fail(
      new DocsGateManifestError({ message: "docs manifest pages must be an array" })
    )
  }
  const pages = value["pages"]
  const typedPages = []
  for (const page of pages) {
    if (!isManifestRecord(page)) {
      return Effect.fail(
        new DocsGateManifestError({ message: "docs manifest pages must contain objects" })
      )
    }
    if (typeof page["id"] !== "string") {
      return Effect.fail(
        new DocsGateManifestError({ message: "docs manifest page id must be a string" })
      )
    }
    if (typeof page["title"] !== "string") {
      return Effect.fail(
        new DocsGateManifestError({ message: "docs manifest page title must be a string" })
      )
    }
    if (typeof page["path"] !== "string") {
      return Effect.fail(
        new DocsGateManifestError({ message: "docs manifest page path must be a string" })
      )
    }
    typedPages.push({
      id: page["id"],
      title: page["title"],
      path: page["path"]
    })
  }
  return Effect.succeed({
    schemaVersion: 1,
    source: value["source"],
    pages: typedPages
  })
}

const isManifestRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

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
    const result = yield* runner(invocation).pipe(Effect.timeoutOption(`${timeoutMillis} millis`))
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
    let child: ReturnType<typeof Bun.spawn> | undefined
    const effect = Effect.gen(function* () {
      const file = join(directory, `docs-example-${invocation.blockIndex}.ts`)
      yield* writeText(file, invocation.code)
      const runningChild = yield* Effect.try({
        try: () =>
          Bun.spawn(["bun", file], {
            cwd: invocation.cwd,
            stdout: "ignore",
            stderr: "pipe"
          }),
        catch: (cause) =>
          new DocsGateExampleFailedError({
            file: invocation.file,
            blockIndex: invocation.blockIndex,
            message: `failed to start docs example ${invocation.file}#${invocation.blockIndex}`,
            cause
          })
      })
      child = runningChild
      const exitCode = yield* waitForDocsExampleExit(runningChild, invocation)
      const stderr = yield* Effect.tryPromise({
        try: () => new Response(runningChild.stderr).text(),
        catch: (cause) =>
          new DocsGateExampleFailedError({
            file: invocation.file,
            blockIndex: invocation.blockIndex,
            message: `failed to read docs example stderr ${invocation.file}#${invocation.blockIndex}`,
            cause
          })
      })
      if (exitCode !== 0) {
        return yield* Effect.fail(
          new DocsGateExampleFailedError({
            file: invocation.file,
            blockIndex: invocation.blockIndex,
            message: `docs example ${invocation.file}#${invocation.blockIndex} exited with ${exitCode}`,
            exitCode,
            stderr
          })
        )
      }
    })
    yield* effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          child?.kill()
        }).pipe(Effect.ignore)
      ),
      Effect.ensuring(removePath(directory).pipe(Effect.ignore))
    )
  })

const waitForDocsExampleExit = (
  child: ReturnType<typeof Bun.spawn>,
  invocation: DocsExampleInvocation
): Effect.Effect<number, DocsGateExampleFailedError, never> =>
  Effect.tryPromise({
    try: () => child.exited,
    catch: (cause) =>
      new DocsGateExampleFailedError({
        file: invocation.file,
        blockIndex: invocation.blockIndex,
        message: `failed while waiting for docs example ${invocation.file}#${invocation.blockIndex}`,
        cause
      })
  }).pipe(
    Effect.timeoutOption(`${DEFAULT_EXAMPLE_TIMEOUT_MILLIS} millis`),
    Effect.flatMap((result) => {
      if (Option.isSome(result)) {
        return Effect.succeed(result.value)
      }
      return Effect.fail(
        new DocsGateExampleFailedError({
          file: invocation.file,
          blockIndex: invocation.blockIndex,
          message: `docs example ${invocation.file}#${invocation.blockIndex} timed out after ${DEFAULT_EXAMPLE_TIMEOUT_MILLIS}ms`
        })
      )
    })
  )

const readJson = <A>(path: string): Effect.Effect<A, DocsGateFileError, never> =>
  Effect.gen(function* () {
    const body = yield* readText(path)
    return yield* Effect.try({
      try: () => JSON.parse(body) as A,
      catch: (cause) =>
        new DocsGateFileError({
          operation: "parse",
          path,
          message: `failed to parse ${path}`,
          cause
        })
    })
  })

const readText = (path: string): Effect.Effect<string, DocsGateFileError, never> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) =>
      new DocsGateFileError({
        operation: "read",
        path,
        message: `failed to read ${path}`,
        cause
      })
  })

const writeText = (path: string, text: string): Effect.Effect<void, DocsGateFileError, never> =>
  Effect.tryPromise({
    try: () => writeFile(path, text),
    catch: (cause) =>
      new DocsGateFileError({
        operation: "write",
        path,
        message: `failed to write ${path}`,
        cause
      })
  })

const makeTempDirectory = (cwd: string): Effect.Effect<string, DocsGateFileError, never> =>
  Effect.tryPromise({
    try: () => mkdtemp(join(cwd, ".docs-examples-")),
    catch: (cause) =>
      new DocsGateFileError({
        operation: "mkdtemp",
        path: cwd,
        message: "failed to create docs example temp directory",
        cause
      })
  })

const removePath = (path: string): Effect.Effect<void, DocsGateFileError, never> =>
  Effect.tryPromise({
    try: () => rm(path, { recursive: true, force: true }),
    catch: (cause) =>
      new DocsGateFileError({
        operation: "rm",
        path,
        message: `failed to remove ${path}`,
        cause
      })
  })

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null

export const readDocsManifestPageIds = (value: unknown): readonly string[] =>
  isRecord(value) && Array.isArray(value["pages"])
    ? value["pages"].flatMap((page) =>
        isRecord(page) && typeof page["id"] === "string" ? [page["id"]] : []
      )
    : []
