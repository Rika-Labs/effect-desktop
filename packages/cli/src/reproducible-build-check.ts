import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"

import { Data, Effect, Exit } from "effect"

export class ReproBuildRunError extends Data.TaggedError("ReproBuildRunError")<{
  readonly pass: ReproPassName
  readonly message: string
  readonly cause: unknown
}> {}

export class ReproPackageRunError extends Data.TaggedError("ReproPackageRunError")<{
  readonly pass: ReproPassName
  readonly message: string
  readonly cause: unknown
}> {}

export class ReproFileError extends Data.TaggedError("ReproFileError")<{
  readonly operation: string
  readonly path: string
  readonly message: string
  readonly cause: unknown
}> {}

export class ReproDiffError extends Data.TaggedError("ReproDiffError")<{
  readonly report: DesktopReproReport
  readonly message: string
}> {}

export type ReproCheckError =
  | ReproBuildRunError
  | ReproPackageRunError
  | ReproFileError
  | ReproDiffError

export type ReproPassName = "first" | "second"

export interface ReproRunnerOptions {
  readonly now: () => number
}

export interface ReproBuildReport {
  readonly target: string
  readonly layoutPath: string
}

export interface ReproPackageReport {
  readonly outputPath: string
}

export type ReproBuildRunner = (
  options: ReproRunnerOptions
) => Effect.Effect<ReproBuildReport, unknown, never>

export type ReproPackageRunner = (
  options: ReproRunnerOptions
) => Effect.Effect<ReproPackageReport, unknown, never>

export interface DesktopReproOptions {
  readonly buildRunner: ReproBuildRunner
  readonly packageRunner: ReproPackageRunner
}

export interface ReproDifference {
  readonly relativePath: string
  readonly kind: "missing-in-first" | "missing-in-second" | "content"
  readonly firstDifferenceOffset: number | undefined
  readonly firstSizeBytes: number | undefined
  readonly secondSizeBytes: number | undefined
  readonly firstSha256: string | undefined
  readonly secondSha256: string | undefined
}

export interface DesktopReproReport {
  readonly passed: boolean
  readonly target: string
  readonly comparedFiles: number
  readonly firstSnapshotPath: string
  readonly secondSnapshotPath: string
  readonly differences: readonly ReproDifference[]
}

interface ReproSnapshot {
  readonly target: string
  readonly rootPath: string
  readonly packageOutputPath: string
}

interface FileDigest {
  readonly sizeBytes: number
  readonly sha256: string
  readonly content: Uint8Array
}

export const runDesktopReproCheck = (
  options: DesktopReproOptions
): Effect.Effect<DesktopReproReport, ReproCheckError, never> =>
  Effect.gen(function* () {
    const workspace = yield* makeTempDirectory()
    const result = yield* Effect.exit(
      Effect.gen(function* () {
        const first = yield* runPass(options, "first", join(workspace, "first"))
        yield* removePath(first.packageOutputPath)
        const second = yield* runPass(options, "second", join(workspace, "second"))
        const report = yield* diffSnapshots(first, second)
        if (!report.passed) {
          return yield* Effect.fail(
            new ReproDiffError({
              report,
              message: `reproducibility check found ${report.differences.length.toString()} differing file(s)`
            })
          )
        }
        return report
      })
    )
    const cleanup = yield* Effect.exit(removePath(workspace))
    if (Exit.isFailure(cleanup) && Exit.isSuccess(result)) {
      return yield* Effect.fail(
        new ReproFileError({
          operation: "cleanup",
          path: workspace,
          message: `failed to clean reproducibility workspace ${workspace}`,
          cause: cleanup.cause
        })
      )
    }
    return yield* result
  })

export const formatReproReport = (report: DesktopReproReport): string => {
  if (report.passed) {
    return [
      "Effect Desktop reproducibility check",
      `target            ${report.target}`,
      `compared files    ${report.comparedFiles.toString()}`,
      "result            byte-identical",
      ""
    ].join("\n")
  }

  return [
    "Effect Desktop reproducibility check",
    `target            ${report.target}`,
    `compared files    ${report.comparedFiles.toString()}`,
    `differences       ${report.differences.length.toString()}`,
    ...report.differences.map(formatDifference),
    ""
  ].join("\n")
}

export const formatReproError = (
  error: ReproCheckError
): { readonly tag: string; readonly message: string; readonly report?: DesktopReproReport } => {
  if (error instanceof ReproDiffError) {
    return { tag: error._tag, message: error.message, report: error.report }
  }
  if (error instanceof ReproBuildRunError) {
    return { tag: error._tag, message: `${error.pass} build failed: ${error.message}` }
  }
  if (error instanceof ReproPackageRunError) {
    return { tag: error._tag, message: `${error.pass} package failed: ${error.message}` }
  }
  if (error instanceof ReproFileError) {
    return { tag: error._tag, message: error.message }
  }
  return { tag: "UnknownReproError", message: "unknown reproducibility check error" }
}

const runPass = (
  options: DesktopReproOptions,
  pass: ReproPassName,
  snapshotRoot: string
): Effect.Effect<ReproSnapshot, ReproCheckError, never> =>
  Effect.gen(function* () {
    const clock = deterministicClock()
    const buildReport = yield* options.buildRunner({ now: clock }).pipe(
      Effect.mapError(
        (cause) =>
          new ReproBuildRunError({
            pass,
            message: formatUnknownError(cause),
            cause
          })
      )
    )
    const packageReport = yield* options.packageRunner({ now: clock }).pipe(
      Effect.mapError(
        (cause) =>
          new ReproPackageRunError({
            pass,
            message: formatUnknownError(cause),
            cause
          })
      )
    )
    const buildSnapshotPath = join(snapshotRoot, "build-layout")
    const packageSnapshotPath = join(snapshotRoot, "package-output")
    yield* copyDirectory(buildReport.layoutPath, buildSnapshotPath)
    yield* copyDirectory(packageReport.outputPath, packageSnapshotPath)
    return {
      target: buildReport.target,
      rootPath: snapshotRoot,
      packageOutputPath: packageReport.outputPath
    }
  })

const diffSnapshots = (
  first: ReproSnapshot,
  second: ReproSnapshot
): Effect.Effect<DesktopReproReport, ReproFileError, never> =>
  Effect.gen(function* () {
    const firstFiles = yield* listRelativeFiles(first.rootPath)
    const secondFiles = yield* listRelativeFiles(second.rootPath)
    const relativePaths = [...new Set([...firstFiles, ...secondFiles])].toSorted()
    const differences: ReproDifference[] = []

    for (const relativePath of relativePaths) {
      const firstPath = join(first.rootPath, relativePath)
      const secondPath = join(second.rootPath, relativePath)
      const firstHasFile = firstFiles.includes(relativePath)
      const secondHasFile = secondFiles.includes(relativePath)

      if (!firstHasFile || !secondHasFile) {
        const existing = yield* digestFile(firstHasFile ? firstPath : secondPath)
        differences.push({
          relativePath,
          kind: firstHasFile ? "missing-in-second" : "missing-in-first",
          firstDifferenceOffset: undefined,
          firstSizeBytes: firstHasFile ? existing.sizeBytes : undefined,
          secondSizeBytes: secondHasFile ? existing.sizeBytes : undefined,
          firstSha256: firstHasFile ? existing.sha256 : undefined,
          secondSha256: secondHasFile ? existing.sha256 : undefined
        })
        continue
      }

      const firstDigest = yield* digestFile(firstPath)
      const secondDigest = yield* digestFile(secondPath)
      if (firstDigest.sha256 !== secondDigest.sha256) {
        differences.push({
          relativePath,
          kind: "content",
          firstDifferenceOffset: firstDifferenceOffset(firstDigest.content, secondDigest.content),
          firstSizeBytes: firstDigest.sizeBytes,
          secondSizeBytes: secondDigest.sizeBytes,
          firstSha256: firstDigest.sha256,
          secondSha256: secondDigest.sha256
        })
      }
    }

    return {
      passed: differences.length === 0,
      target: first.target,
      comparedFiles: relativePaths.length,
      firstSnapshotPath: first.rootPath,
      secondSnapshotPath: second.rootPath,
      differences
    }
  })

const listRelativeFiles = (
  rootPath: string
): Effect.Effect<readonly string[], ReproFileError, never> =>
  Effect.gen(function* () {
    const files = yield* listFiles(rootPath)
    return files.map((path) => relative(rootPath, path)).toSorted()
  })

const listFiles = (path: string): Effect.Effect<readonly string[], ReproFileError, never> =>
  Effect.gen(function* () {
    const entries = yield* readDirectory(path)
    const files: string[] = []
    for (const entry of entries.toSorted()) {
      const child = join(path, entry)
      const childStat = yield* statPath(child)
      if (childStat.isDirectory()) {
        files.push(...(yield* listFiles(child)))
      } else {
        files.push(child)
      }
    }
    return files
  })

const copyDirectory = (
  source: string,
  destination: string
): Effect.Effect<void, ReproFileError, never> =>
  Effect.gen(function* () {
    yield* makeDirectory(destination)
    const entries = yield* readDirectory(source)
    for (const entry of entries.toSorted()) {
      const sourcePath = join(source, entry)
      const destinationPath = join(destination, entry)
      const entryStat = yield* statPath(sourcePath)
      if (entryStat.isDirectory()) {
        yield* copyDirectory(sourcePath, destinationPath)
      } else {
        yield* copyFileEffect(sourcePath, destinationPath)
      }
    }
  })

const digestFile = (path: string): Effect.Effect<FileDigest, ReproFileError, never> =>
  Effect.gen(function* () {
    const content = yield* readFileEffect(path)
    return {
      sizeBytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
      content
    }
  })

const firstDifferenceOffset = (first: Uint8Array, second: Uint8Array): number | undefined => {
  const length = Math.min(first.byteLength, second.byteLength)
  for (let offset = 0; offset < length; offset += 1) {
    if ((first[offset] ?? -1) !== (second[offset] ?? -1)) {
      return offset
    }
  }
  return first.byteLength === second.byteLength ? undefined : length
}

const deterministicClock = (): (() => number) => {
  let tick = 0
  return () => {
    tick += 1
    return tick
  }
}

const formatDifference = (difference: ReproDifference): string => {
  const offset =
    difference.firstDifferenceOffset === undefined
      ? "n/a"
      : difference.firstDifferenceOffset.toString()
  return [
    `${difference.relativePath}`,
    `  kind            ${difference.kind}`,
    `  offset          ${offset}`,
    `  first sha256    ${difference.firstSha256 ?? "missing"}`,
    `  second sha256   ${difference.secondSha256 ?? "missing"}`
  ].join("\n")
}

const makeTempDirectory = (): Effect.Effect<string, ReproFileError, never> =>
  Effect.tryPromise({
    try: () => mkdtemp(join(tmpdir(), "effect-desktop-repro-")),
    catch: (cause) =>
      new ReproFileError({
        operation: "mkdtemp",
        path: tmpdir(),
        message: "failed to create reproducibility workspace",
        cause
      })
  })

const makeDirectory = (path: string): Effect.Effect<void, ReproFileError, never> =>
  Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }),
    catch: (cause) =>
      new ReproFileError({
        operation: "mkdir",
        path,
        message: `failed to create ${path}`,
        cause
      })
  }).pipe(Effect.asVoid)

const removePath = (path: string): Effect.Effect<void, ReproFileError, never> =>
  Effect.tryPromise({
    try: () => rm(path, { recursive: true, force: true }),
    catch: (cause) =>
      new ReproFileError({
        operation: "rm",
        path,
        message: `failed to remove ${path}`,
        cause
      })
  })

const readDirectory = (path: string): Effect.Effect<readonly string[], ReproFileError, never> =>
  Effect.tryPromise({
    try: () => readdir(path),
    catch: (cause) =>
      new ReproFileError({
        operation: "readdir",
        path,
        message: `failed to read ${path}`,
        cause
      })
  })

const readFileEffect = (path: string): Effect.Effect<Uint8Array, ReproFileError, never> =>
  Effect.tryPromise({
    try: () => readFile(path),
    catch: (cause) =>
      new ReproFileError({
        operation: "read",
        path,
        message: `failed to read ${path}`,
        cause
      })
  })

const statPath = (
  path: string
): Effect.Effect<Awaited<ReturnType<typeof stat>>, ReproFileError, never> =>
  Effect.tryPromise({
    try: () => stat(path),
    catch: (cause) =>
      new ReproFileError({
        operation: "stat",
        path,
        message: `failed to stat ${path}`,
        cause
      })
  })

const copyFileEffect = (
  source: string,
  destination: string
): Effect.Effect<void, ReproFileError, never> =>
  Effect.gen(function* () {
    yield* makeDirectory(dirname(destination))
    yield* Effect.tryPromise({
      try: () => copyFile(source, destination),
      catch: (cause) =>
        new ReproFileError({
          operation: "copy",
          path: source,
          message: `failed to copy ${source} to ${destination}`,
          cause
        })
    })
  })

const formatUnknownError = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)
