import {
  lstat,
  mkdir,
  readFile,
  rm,
  rmdir,
  stat as nodeStat,
  unlink,
  writeFile
} from "node:fs/promises"

import {
  HostProtocolDiskFullError,
  HostProtocolFileNotFoundError,
  HostProtocolInvalidArgumentError,
  HostProtocolPermissionDeniedError,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Schema } from "effect"

const NonEmptyPath = Schema.NonEmptyString

export class FilesystemPathInput extends Schema.Class<FilesystemPathInput>("FilesystemPathInput")({
  path: NonEmptyPath
}) {}

export class FilesystemWriteInput extends Schema.Class<FilesystemWriteInput>(
  "FilesystemWriteInput"
)({
  path: NonEmptyPath,
  bytes: Schema.Uint8Array
}) {}

export class FilesystemMkdirInput extends Schema.Class<FilesystemMkdirInput>(
  "FilesystemMkdirInput"
)({
  path: NonEmptyPath,
  recursive: Schema.optionalKey(Schema.Boolean)
}) {}

export class FilesystemRemoveInput extends Schema.Class<FilesystemRemoveInput>(
  "FilesystemRemoveInput"
)({
  path: NonEmptyPath,
  recursive: Schema.optionalKey(Schema.Boolean)
}) {}

export const FilesystemEntryKind = Schema.Literals(["file", "directory", "symlink", "other"])
export type FilesystemEntryKind = typeof FilesystemEntryKind.Type

export class FilesystemStatResult extends Schema.Class<FilesystemStatResult>(
  "FilesystemStatResult"
)({
  path: Schema.String,
  kind: FilesystemEntryKind,
  sizeBytes: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  modifiedAtMs: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
}) {}

export type FilesystemError = HostProtocolError

export interface FilesystemApi {
  readonly read: (path: string) => Effect.Effect<Uint8Array, FilesystemError, never>
  readonly write: (path: string, bytes: Uint8Array) => Effect.Effect<void, FilesystemError, never>
  readonly stat: (path: string) => Effect.Effect<FilesystemStatResult, FilesystemError, never>
  readonly mkdir: (
    path: string,
    options?: { readonly recursive?: boolean }
  ) => Effect.Effect<void, FilesystemError, never>
  readonly remove: (
    path: string,
    options?: { readonly recursive?: boolean }
  ) => Effect.Effect<void, FilesystemError, never>
}

export interface FilesystemAdapter {
  readonly readFile: typeof readFile
  readonly writeFile: typeof writeFile
  readonly stat: typeof nodeStat
  readonly mkdir: (path: string, options?: { readonly recursive: true }) => Promise<void>
  readonly remove: (path: string, options?: { readonly recursive: true }) => Promise<void>
}

export interface FilesystemOptions {
  readonly adapter?: FilesystemAdapter
}

export const makeFilesystem = (
  options: FilesystemOptions = {}
): Effect.Effect<FilesystemApi, never, never> =>
  Effect.sync(() => {
    const adapter = options.adapter ?? NodeFilesystemAdapter

    return Object.freeze({
      read: (path: string) =>
        Effect.gen(function* () {
          const input = yield* decodePathInput({ path }, "Filesystem.read")
          return yield* Effect.tryPromise({
            try: () => adapter.readFile(input.path),
            catch: (error) => mapFilesystemError(error, input.path, "Filesystem.read")
          }).pipe(Effect.map((bytes) => new Uint8Array(bytes)))
        }).pipe(Effect.withSpan("Filesystem.read", { attributes: { path } })),
      write: (path: string, bytes: Uint8Array) =>
        Effect.gen(function* () {
          const input = yield* decodeWriteInput({ path, bytes }, "Filesystem.write")
          yield* Effect.tryPromise({
            try: () => adapter.writeFile(input.path, input.bytes),
            catch: (error) => mapFilesystemError(error, input.path, "Filesystem.write")
          })
        }).pipe(Effect.withSpan("Filesystem.write", { attributes: { path } })),
      stat: (path: string) =>
        Effect.gen(function* () {
          const input = yield* decodePathInput({ path }, "Filesystem.stat")
          const result = yield* Effect.tryPromise({
            try: () => adapter.stat(input.path),
            catch: (error) => mapFilesystemError(error, input.path, "Filesystem.stat")
          })

          return new FilesystemStatResult({
            path: input.path,
            kind: statKind(result),
            sizeBytes: result.size,
            modifiedAtMs: result.mtimeMs
          })
        }).pipe(Effect.withSpan("Filesystem.stat", { attributes: { path } })),
      mkdir: (path: string, options?: { readonly recursive?: boolean }) =>
        Effect.gen(function* () {
          const input = yield* decodeMkdirInput(
            { path, ...(options?.recursive === undefined ? {} : { recursive: options.recursive }) },
            "Filesystem.mkdir"
          )
          yield* Effect.tryPromise({
            try: () =>
              input.recursive === true
                ? adapter.mkdir(input.path, { recursive: true })
                : adapter.mkdir(input.path),
            catch: (error) => mapFilesystemError(error, input.path, "Filesystem.mkdir")
          })
        }).pipe(Effect.withSpan("Filesystem.mkdir", { attributes: { path } })),
      remove: (path: string, options?: { readonly recursive?: boolean }) =>
        Effect.gen(function* () {
          const input = yield* decodeRemoveInput(
            { path, ...(options?.recursive === undefined ? {} : { recursive: options.recursive }) },
            "Filesystem.remove"
          )
          yield* Effect.tryPromise({
            try: () =>
              input.recursive === true
                ? adapter.remove(input.path, { recursive: true })
                : adapter.remove(input.path),
            catch: (error) => mapFilesystemError(error, input.path, "Filesystem.remove")
          })
        }).pipe(Effect.withSpan("Filesystem.remove", { attributes: { path } }))
    })
  })

export class Filesystem extends Context.Service<Filesystem, FilesystemApi>()("Filesystem") {}

export const FilesystemLive = Layer.effect(Filesystem)(makeFilesystem())

const NodeFilesystemAdapter: FilesystemAdapter = {
  readFile,
  writeFile,
  stat: lstat,
  mkdir: (path, options) => mkdir(path, options).then(() => undefined),
  remove: (path, options) =>
    options?.recursive === true
      ? rm(path, { recursive: true }).then(() => undefined)
      : removeSinglePath(path)
}

const removeSinglePath = async (path: string): Promise<void> => {
  const stats = await lstat(path)
  if (stats.isDirectory()) {
    await rmdir(path)
    return
  }
  await unlink(path)
}

const decodePathInput = (
  input: unknown,
  operation: string
): Effect.Effect<FilesystemPathInput, HostProtocolInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(FilesystemPathInput)(input).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWriteInput = (
  input: unknown,
  operation: string
): Effect.Effect<FilesystemWriteInput, HostProtocolInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(FilesystemWriteInput)(input).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeMkdirInput = (
  input: unknown,
  operation: string
): Effect.Effect<FilesystemMkdirInput, HostProtocolInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(FilesystemMkdirInput)(input).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeRemoveInput = (
  input: unknown,
  operation: string
): Effect.Effect<FilesystemRemoveInput, HostProtocolInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(FilesystemRemoveInput)(input).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const statKind = (stats: Awaited<ReturnType<typeof nodeStat>>): FilesystemEntryKind => {
  if (stats.isFile()) {
    return "file"
  }
  if (stats.isDirectory()) {
    return "directory"
  }
  if (stats.isSymbolicLink()) {
    return "symlink"
  }
  return "other"
}

const mapFilesystemError = (error: unknown, path: string, operation: string): HostProtocolError => {
  if (isNodeError(error)) {
    switch (error.code) {
      case "ENOENT":
        return new HostProtocolFileNotFoundError({
          tag: "FileNotFound",
          path,
          code: error.code,
          cause: sanitizeNodeError(error),
          ...common("FileNotFound", `file not found: ${path}`, operation)
        })
      case "EACCES":
      case "EPERM":
        return new HostProtocolPermissionDeniedError({
          tag: "PermissionDenied",
          capability: filesystemCapability(operation),
          resource: path,
          code: error.code,
          cause: sanitizeNodeError(error),
          ...common("PermissionDenied", `permission denied: ${path}`, operation)
        })
      case "ENOSPC":
        return new HostProtocolDiskFullError({
          tag: "DiskFull",
          path,
          freeBytes: 0,
          code: error.code,
          cause: sanitizeNodeError(error),
          ...common("DiskFull", `disk full while accessing: ${path}`, operation)
        })
      case "EISDIR":
      case "ENOTDIR":
      case "EINVAL":
        return makeHostProtocolInvalidArgumentError("path", error.message, operation)
      default:
        return makeHostProtocolInvalidArgumentError("path", error.message, operation)
    }
  }

  return makeHostProtocolInvalidArgumentError("path", formatUnknownError(error), operation)
}

const common = (
  tag: "FileNotFound" | "PermissionDenied" | "DiskFull",
  message: string,
  operation: string
) => ({
  message,
  operation,
  recoverable: tag === "DiskFull"
})

const filesystemCapability = (operation: string): string =>
  operation === "Filesystem.read" || operation === "Filesystem.stat"
    ? "filesystem.read"
    : "filesystem.write"

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  typeof error === "object" && error !== null && "code" in error

const sanitizeNodeError = (error: NodeJS.ErrnoException): Record<string, string> => ({
  name: error.name,
  message: error.message,
  ...(error.code === undefined ? {} : { code: error.code })
})

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
