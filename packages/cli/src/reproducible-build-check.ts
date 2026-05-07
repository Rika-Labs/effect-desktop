import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink
} from "node:fs/promises"
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

export type ReproEntryKind = "file" | "symlink"

export interface ReproDifference {
  readonly relativePath: string
  readonly kind:
    | "missing-in-first"
    | "missing-in-second"
    | "content"
    | "entry-type"
    | "symlink-target"
  readonly firstDifferenceOffset: number | undefined
  readonly firstSizeBytes: number | undefined
  readonly secondSizeBytes: number | undefined
  readonly firstSha256: string | undefined
  readonly secondSha256: string | undefined
  readonly firstEntryKind: ReproEntryKind | undefined
  readonly secondEntryKind: ReproEntryKind | undefined
  readonly firstSymlinkTarget: string | undefined
  readonly secondSymlinkTarget: string | undefined
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

type SnapshotEntry =
  | {
      readonly relativePath: string
      readonly kind: "file"
      readonly absolutePath: string
      readonly sizeBytes: number
      readonly sha256: string
    }
  | {
      readonly relativePath: string
      readonly kind: "symlink"
      readonly absolutePath: string
      readonly target: string
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
    const firstEntries = yield* listSnapshotEntries(first.rootPath)
    const secondEntries = yield* listSnapshotEntries(second.rootPath)
    const firstByPath = new Map(firstEntries.map((entry) => [entry.relativePath, entry]))
    const secondByPath = new Map(secondEntries.map((entry) => [entry.relativePath, entry]))
    const relativePaths = [...new Set([...firstByPath.keys(), ...secondByPath.keys()])].toSorted()
    const differences: ReproDifference[] = []

    for (const relativePath of relativePaths) {
      const firstEntry = firstByPath.get(relativePath)
      const secondEntry = secondByPath.get(relativePath)

      if (firstEntry === undefined || secondEntry === undefined) {
        const present = firstEntry ?? secondEntry
        if (present === undefined) {
          continue
        }
        differences.push({
          relativePath,
          kind: firstEntry === undefined ? "missing-in-first" : "missing-in-second",
          firstDifferenceOffset: undefined,
          firstSizeBytes:
            firstEntry !== undefined && firstEntry.kind === "file"
              ? firstEntry.sizeBytes
              : undefined,
          secondSizeBytes:
            secondEntry !== undefined && secondEntry.kind === "file"
              ? secondEntry.sizeBytes
              : undefined,
          firstSha256:
            firstEntry !== undefined && firstEntry.kind === "file" ? firstEntry.sha256 : undefined,
          secondSha256:
            secondEntry !== undefined && secondEntry.kind === "file"
              ? secondEntry.sha256
              : undefined,
          firstEntryKind: firstEntry?.kind,
          secondEntryKind: secondEntry?.kind,
          firstSymlinkTarget:
            firstEntry !== undefined && firstEntry.kind === "symlink"
              ? firstEntry.target
              : undefined,
          secondSymlinkTarget:
            secondEntry !== undefined && secondEntry.kind === "symlink"
              ? secondEntry.target
              : undefined
        })
        continue
      }

      if (firstEntry.kind !== secondEntry.kind) {
        differences.push({
          relativePath,
          kind: "entry-type",
          firstDifferenceOffset: undefined,
          firstSizeBytes: firstEntry.kind === "file" ? firstEntry.sizeBytes : undefined,
          secondSizeBytes: secondEntry.kind === "file" ? secondEntry.sizeBytes : undefined,
          firstSha256: firstEntry.kind === "file" ? firstEntry.sha256 : undefined,
          secondSha256: secondEntry.kind === "file" ? secondEntry.sha256 : undefined,
          firstEntryKind: firstEntry.kind,
          secondEntryKind: secondEntry.kind,
          firstSymlinkTarget: firstEntry.kind === "symlink" ? firstEntry.target : undefined,
          secondSymlinkTarget: secondEntry.kind === "symlink" ? secondEntry.target : undefined
        })
        continue
      }

      if (firstEntry.kind === "symlink" && secondEntry.kind === "symlink") {
        if (firstEntry.target !== secondEntry.target) {
          differences.push({
            relativePath,
            kind: "symlink-target",
            firstDifferenceOffset: undefined,
            firstSizeBytes: undefined,
            secondSizeBytes: undefined,
            firstSha256: undefined,
            secondSha256: undefined,
            firstEntryKind: "symlink",
            secondEntryKind: "symlink",
            firstSymlinkTarget: firstEntry.target,
            secondSymlinkTarget: secondEntry.target
          })
        }
        continue
      }

      if (firstEntry.kind === "file" && secondEntry.kind === "file") {
        if (firstEntry.sha256 !== secondEntry.sha256) {
          const firstBytes = yield* readFileEffect(firstEntry.absolutePath)
          const secondBytes = yield* readFileEffect(secondEntry.absolutePath)
          differences.push({
            relativePath,
            kind: "content",
            firstDifferenceOffset: firstDifferenceOffset(firstBytes, secondBytes),
            firstSizeBytes: firstEntry.sizeBytes,
            secondSizeBytes: secondEntry.sizeBytes,
            firstSha256: firstEntry.sha256,
            secondSha256: secondEntry.sha256,
            firstEntryKind: "file",
            secondEntryKind: "file",
            firstSymlinkTarget: undefined,
            secondSymlinkTarget: undefined
          })
        }
        continue
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

const listSnapshotEntries = (
  rootPath: string
): Effect.Effect<readonly SnapshotEntry[], ReproFileError, never> =>
  Effect.gen(function* () {
    const entries: SnapshotEntry[] = []
    yield* walkSnapshotEntries(rootPath, rootPath, entries)
    return entries.toSorted((a, b) => a.relativePath.localeCompare(b.relativePath))
  })

const walkSnapshotEntries = (
  rootPath: string,
  currentPath: string,
  out: SnapshotEntry[]
): Effect.Effect<void, ReproFileError, never> =>
  Effect.gen(function* () {
    const children = yield* readDirectory(currentPath)
    for (const child of children.toSorted()) {
      const childPath = join(currentPath, child)
      const childStat = yield* lstatPath(childPath)
      const relativePath = relative(rootPath, childPath)
      if (childStat.isSymbolicLink()) {
        const target = yield* readlinkEffect(childPath)
        out.push({ relativePath, kind: "symlink", absolutePath: childPath, target })
      } else if (childStat.isDirectory()) {
        yield* walkSnapshotEntries(rootPath, childPath, out)
      } else {
        const { sizeBytes, sha256 } = yield* streamFileDigest(childPath)
        out.push({ relativePath, kind: "file", absolutePath: childPath, sizeBytes, sha256 })
      }
    }
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
      const entryStat = yield* lstatPath(sourcePath)
      if (entryStat.isSymbolicLink()) {
        const target = yield* readlinkEffect(sourcePath)
        yield* symlinkEffect(target, destinationPath)
      } else if (entryStat.isDirectory()) {
        yield* copyDirectory(sourcePath, destinationPath)
      } else {
        yield* copyFileEffect(sourcePath, destinationPath)
      }
    }
  })

const streamFileDigest = (
  path: string
): Effect.Effect<{ readonly sizeBytes: number; readonly sha256: string }, ReproFileError, never> =>
  Effect.tryPromise({
    try: async () => {
      const hash = createHash("sha256")
      let sizeBytes = 0
      const stream = createReadStream(path)
      for await (const chunk of stream) {
        const buffer = chunk as Buffer
        sizeBytes += buffer.byteLength
        hash.update(buffer)
      }
      return { sizeBytes, sha256: hash.digest("hex") }
    },
    catch: (cause) =>
      new ReproFileError({
        operation: "read",
        path,
        message: `failed to read ${path}`,
        cause
      })
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
  const lines: string[] = [`${difference.relativePath}`, `  kind            ${difference.kind}`]
  if (difference.kind === "entry-type") {
    lines.push(`  first kind      ${difference.firstEntryKind ?? "missing"}`)
    lines.push(`  second kind     ${difference.secondEntryKind ?? "missing"}`)
    return lines.join("\n")
  }
  if (difference.kind === "symlink-target") {
    lines.push(`  first target    ${difference.firstSymlinkTarget ?? "missing"}`)
    lines.push(`  second target   ${difference.secondSymlinkTarget ?? "missing"}`)
    return lines.join("\n")
  }
  const offset =
    difference.firstDifferenceOffset === undefined
      ? "n/a"
      : difference.firstDifferenceOffset.toString()
  lines.push(`  offset          ${offset}`)
  lines.push(`  first sha256    ${difference.firstSha256 ?? "missing"}`)
  lines.push(`  second sha256   ${difference.secondSha256 ?? "missing"}`)
  return lines.join("\n")
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

const lstatPath = (
  path: string
): Effect.Effect<Awaited<ReturnType<typeof lstat>>, ReproFileError, never> =>
  Effect.tryPromise({
    try: () => lstat(path),
    catch: (cause) =>
      new ReproFileError({
        operation: "lstat",
        path,
        message: `failed to stat ${path}`,
        cause
      })
  })

const readlinkEffect = (path: string): Effect.Effect<string, ReproFileError, never> =>
  Effect.tryPromise({
    try: () => readlink(path),
    catch: (cause) =>
      new ReproFileError({
        operation: "readlink",
        path,
        message: `failed to read symlink target at ${path}`,
        cause
      })
  })

const symlinkEffect = (target: string, path: string): Effect.Effect<void, ReproFileError, never> =>
  Effect.gen(function* () {
    yield* makeDirectory(dirname(path))
    yield* Effect.tryPromise({
      try: () => symlink(target, path),
      catch: (cause) =>
        new ReproFileError({
          operation: "symlink",
          path,
          message: `failed to create symlink at ${path} -> ${target}`,
          cause
        })
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
