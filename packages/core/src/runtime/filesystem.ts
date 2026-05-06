import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename as nodeRename,
  rm,
  rmdir,
  stat as nodeStat,
  unlink,
  writeFile
} from "node:fs/promises"
import { watch as nodeWatch } from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"

import {
  HostProtocolDiskFullError,
  HostProtocolFileNotFoundError,
  HostProtocolInvalidArgumentError,
  HostProtocolPermissionDeniedError,
  HostProtocolSymlinkEscapesRootError,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Cause, Context, Effect, Layer, Queue, Schema, Stream } from "effect"

import { ResourceRegistry, type ResourceRegistryApi } from "./resources.js"

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

export class FilesystemWatchInput extends Schema.Class<FilesystemWatchInput>(
  "FilesystemWatchInput"
)({
  path: NonEmptyPath,
  ownerScope: NonEmptyPath,
  bufferSize: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(65_536))
  )
}) {}

export const FilesystemEntryKind = Schema.Literals(["file", "directory", "symlink", "other"])
export type FilesystemEntryKind = typeof FilesystemEntryKind.Type

export const FilesystemEventKind = Schema.Literals(["created", "modified", "deleted", "renamed"])
export type FilesystemEventKind = typeof FilesystemEventKind.Type

export class FilesystemStatResult extends Schema.Class<FilesystemStatResult>(
  "FilesystemStatResult"
)({
  path: Schema.String,
  kind: FilesystemEntryKind,
  sizeBytes: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  modifiedAtMs: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
}) {}

export class FilesystemEvent extends Schema.Class<FilesystemEvent>("FilesystemEvent")({
  kind: FilesystemEventKind,
  path: Schema.String,
  directory: Schema.String,
  filename: Schema.optionalKey(Schema.String)
}) {}

export type FilesystemError = HostProtocolError

export type FilesystemPathCapability = "filesystem.read" | "filesystem.write"

export interface FilesystemApi {
  readonly read: (path: string) => Effect.Effect<Uint8Array, FilesystemError, never>
  readonly realpath: (
    path: string,
    capability?: FilesystemPathCapability
  ) => Effect.Effect<string, FilesystemError, never>
  readonly write: (path: string, bytes: Uint8Array) => Effect.Effect<void, FilesystemError, never>
  readonly writeAtomic: (
    path: string,
    bytes: Uint8Array
  ) => Effect.Effect<void, FilesystemError, never>
  readonly stat: (path: string) => Effect.Effect<FilesystemStatResult, FilesystemError, never>
  readonly mkdir: (
    path: string,
    options?: { readonly recursive?: boolean }
  ) => Effect.Effect<void, FilesystemError, never>
  readonly remove: (
    path: string,
    options?: { readonly recursive?: boolean }
  ) => Effect.Effect<void, FilesystemError, never>
  readonly watch: (
    path: string,
    options?: { readonly ownerScope: string; readonly bufferSize?: number }
  ) => Stream.Stream<FilesystemEvent, FilesystemError, never>
}

export interface FilesystemAdapter {
  readonly readFile: typeof readFile
  readonly realpath: typeof realpath
  readonly rename: typeof nodeRename
  readonly writeFile: typeof writeFile
  readonly writeFileSynced: (path: string, bytes: Uint8Array) => Promise<void>
  readonly stat: typeof nodeStat
  readonly mkdir: (path: string, options?: { readonly recursive: true }) => Promise<void>
  readonly remove: (path: string, options?: { readonly recursive: true }) => Promise<void>
  readonly watch: (
    path: string,
    listener: (event: RawFilesystemEvent) => void,
    onError: (error: FilesystemError) => void
  ) => Effect.Effect<FilesystemWatcher, FilesystemError, never>
}

export interface FilesystemPermissionPolicy {
  readonly readRoots?: readonly string[]
  readonly writeRoots?: readonly string[]
  readonly deleteRoots?: readonly string[]
  readonly allowRecursiveRemove?: boolean
}

export interface FilesystemOptions {
  readonly adapter?: FilesystemAdapter
  readonly permissions?: FilesystemPermissionPolicy
}

export const makeFilesystem = (
  registry: ResourceRegistryApi,
  options: FilesystemOptions = {}
): Effect.Effect<FilesystemApi, never, never> =>
  Effect.sync(() => {
    const adapter = options.adapter ?? NodeFilesystemAdapter
    const permissions = options.permissions ?? EMPTY_FILESYSTEM_PERMISSIONS

    return Object.freeze({
      read: (path: string) =>
        Effect.gen(function* () {
          const input = yield* decodePathInput({ path }, "Filesystem.read")
          const authorizedPath = yield* authorizeFilesystemPath(
            adapter,
            permissions,
            input.path,
            "filesystem.read",
            "Filesystem.read",
            "existing"
          )
          return yield* Effect.tryPromise({
            try: () => adapter.readFile(authorizedPath),
            catch: (error) => mapFilesystemError(error, authorizedPath, "Filesystem.read")
          }).pipe(Effect.map((bytes) => new Uint8Array(bytes)))
        }).pipe(Effect.withSpan("Filesystem.read", { attributes: { path } })),
      realpath: (path: string, capability: FilesystemPathCapability = "filesystem.read") =>
        Effect.gen(function* () {
          const input = yield* decodePathInput({ path }, "Filesystem.realpath")
          return yield* authorizeFilesystemPath(
            adapter,
            permissions,
            input.path,
            capability,
            "Filesystem.realpath",
            "existing"
          )
        }).pipe(Effect.withSpan("Filesystem.realpath", { attributes: { path, capability } })),
      write: (path: string, bytes: Uint8Array) =>
        Effect.gen(function* () {
          const input = yield* decodeWriteInput({ path, bytes }, "Filesystem.write")
          const authorizedPath = yield* authorizeFilesystemPath(
            adapter,
            permissions,
            input.path,
            "filesystem.write",
            "Filesystem.write",
            "leaf-may-be-missing"
          )
          yield* Effect.tryPromise({
            try: () => adapter.writeFile(authorizedPath, input.bytes),
            catch: (error) => mapFilesystemError(error, authorizedPath, "Filesystem.write")
          })
        }).pipe(Effect.withSpan("Filesystem.write", { attributes: { path } })),
      writeAtomic: (path: string, bytes: Uint8Array) =>
        Effect.gen(function* () {
          const input = yield* decodeWriteInput({ path, bytes }, "Filesystem.writeAtomic")
          const authorizedPath = yield* authorizeFilesystemPath(
            adapter,
            permissions,
            input.path,
            "filesystem.write",
            "Filesystem.writeAtomic",
            "leaf-may-be-missing"
          )
          yield* writeAtomicFile(adapter, authorizedPath, input.bytes)
        }).pipe(Effect.withSpan("Filesystem.writeAtomic", { attributes: { path } })),
      stat: (path: string) =>
        Effect.gen(function* () {
          const input = yield* decodePathInput({ path }, "Filesystem.stat")
          const authorizedPath = yield* authorizeFilesystemPath(
            adapter,
            permissions,
            input.path,
            "filesystem.read",
            "Filesystem.stat",
            "existing"
          )
          const result = yield* Effect.tryPromise({
            try: () => adapter.stat(authorizedPath),
            catch: (error) => mapFilesystemError(error, authorizedPath, "Filesystem.stat")
          })

          return new FilesystemStatResult({
            path: authorizedPath,
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
          const authorizedPath = yield* authorizeFilesystemPath(
            adapter,
            permissions,
            input.path,
            "filesystem.write",
            "Filesystem.mkdir",
            "leaf-may-be-missing"
          )
          yield* Effect.tryPromise({
            try: () =>
              input.recursive === true
                ? adapter.mkdir(authorizedPath, { recursive: true })
                : adapter.mkdir(authorizedPath),
            catch: (error) => mapFilesystemError(error, authorizedPath, "Filesystem.mkdir")
          })
        }).pipe(Effect.withSpan("Filesystem.mkdir", { attributes: { path } })),
      remove: (path: string, options?: { readonly recursive?: boolean }) =>
        Effect.gen(function* () {
          const input = yield* decodeRemoveInput(
            { path, ...(options?.recursive === undefined ? {} : { recursive: options.recursive }) },
            "Filesystem.remove"
          )
          const capability =
            input.recursive === true ? "filesystem.delete.recursive" : "filesystem.delete"
          const authorizedPath = yield* authorizeFilesystemPath(
            adapter,
            permissions,
            input.path,
            capability,
            "Filesystem.remove",
            "directory-entry"
          )
          yield* Effect.tryPromise({
            try: () =>
              input.recursive === true
                ? adapter.remove(authorizedPath, { recursive: true })
                : adapter.remove(authorizedPath),
            catch: (error) => mapFilesystemError(error, authorizedPath, "Filesystem.remove")
          })
        }).pipe(Effect.withSpan("Filesystem.remove", { attributes: { path } })),
      watch: (
        path: string,
        options?: { readonly ownerScope: string; readonly bufferSize?: number }
      ) =>
        Stream.unwrap(
          Effect.acquireRelease(
            Effect.gen(function* () {
              const input = yield* decodeWatchInput(
                {
                  path,
                  ...(options === undefined ? {} : options)
                },
                "Filesystem.watch"
              )
              const authorizedPath = yield* authorizeFilesystemPath(
                adapter,
                permissions,
                input.path,
                "filesystem.read",
                "Filesystem.watch",
                "existing"
              )
              const queue = yield* Queue.sliding<FilesystemEvent, FilesystemError | Cause.Done>(
                input.bufferSize ?? DEFAULT_WATCH_BUFFER_SIZE
              )
              const watcher = yield* adapter.watch(
                authorizedPath,
                (event) => {
                  Effect.runFork(handleWatchEvent(queue, adapter, authorizedPath, event))
                },
                (error) => {
                  Effect.runFork(Queue.fail(queue, error))
                }
              )
              const handle = yield* registry.register({
                kind: "filesystem-watch",
                ownerScope: input.ownerScope,
                state: "open",
                dispose: Effect.gen(function* () {
                  yield* Effect.sync(() => watcher.close())
                  yield* Queue.end(queue)
                })
              })

              return { queue, handle }
            }),
            ({ handle }) => registry.dispose(handle.id)
          ).pipe(
            Effect.map(({ queue }) => Stream.fromQueue(queue)),
            Effect.withSpan("Filesystem.watch", { attributes: { path } })
          )
        )
    })
  })

export class Filesystem extends Context.Service<Filesystem, FilesystemApi>()("Filesystem") {}

export const FilesystemLive = Layer.effect(Filesystem)(
  Effect.gen(function* () {
    const registry = yield* ResourceRegistry
    return yield* makeFilesystem(registry)
  })
)

export interface RawFilesystemEvent {
  readonly type: "rename" | "change"
  readonly filename?: string
}

export interface FilesystemWatcher {
  readonly close: () => void
}

const NodeFilesystemAdapter: FilesystemAdapter = {
  readFile,
  realpath,
  rename: nodeRename,
  writeFile,
  writeFileSynced: async (path, bytes) => {
    const file = await open(path, "w")
    try {
      await file.writeFile(bytes)
      await file.sync()
    } finally {
      await file.close()
    }
  },
  stat: lstat,
  mkdir: (path, options) => mkdir(path, options).then(() => undefined),
  remove: (path, options) =>
    options?.recursive === true
      ? rm(path, { recursive: true }).then(() => undefined)
      : removeSinglePath(path),
  watch: (path, listener, onError) =>
    Effect.try({
      try: () => {
        const watcher = nodeWatch(
          path,
          { persistent: false },
          (eventType: string, filename: string | Buffer | null) => {
            if (eventType === "rename" || eventType === "change") {
              listener({
                type: eventType,
                ...(filename === null ? {} : { filename: filename.toString() })
              })
            }
          }
        )
        watcher.on("error", (error) => {
          onError(mapFilesystemError(error, path, "Filesystem.watch"))
        })
        return { close: () => watcher.close() }
      },
      catch: (error) => mapFilesystemError(error, path, "Filesystem.watch")
    })
}

const DEFAULT_WATCH_BUFFER_SIZE = 1_024
const EMPTY_FILESYSTEM_PERMISSIONS: FilesystemPermissionPolicy = Object.freeze({})

const removeSinglePath = async (path: string): Promise<void> => {
  const stats = await lstat(path)
  if (stats.isDirectory()) {
    await rmdir(path)
    return
  }
  await unlink(path)
}

const writeAtomicFile = (
  adapter: FilesystemAdapter,
  path: string,
  bytes: Uint8Array
): Effect.Effect<void, FilesystemError, never> => {
  const tempPath = makeAtomicTempPath(path)
  let committed = false

  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => adapter.writeFileSynced(tempPath, bytes),
      catch: (error) => mapFilesystemError(error, path, "Filesystem.writeAtomic")
    })
    yield* Effect.tryPromise({
      try: () => adapter.rename(tempPath, path),
      catch: (error) => mapFilesystemError(error, path, "Filesystem.writeAtomic")
    })
    yield* Effect.sync(() => {
      committed = true
    })
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        if (!committed) {
          yield* cleanupAtomicTemp(adapter, tempPath)
        }
      })
    )
  )
}

const cleanupAtomicTemp = (
  adapter: FilesystemAdapter,
  tempPath: string
): Effect.Effect<void, never, never> =>
  Effect.tryPromise({
    try: () => adapter.remove(tempPath),
    catch: (error) => error
  }).pipe(
    Effect.catch((error) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return Effect.void
      }
      return Effect.void
    })
  )

const makeAtomicTempPath = (path: string): string => `${path}.tmp.${randomUUID()}`

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

const decodeWatchInput = (
  input: unknown,
  operation: string
): Effect.Effect<FilesystemWatchInput, HostProtocolInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(FilesystemWatchInput)(input).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

type FilesystemCapability =
  | "filesystem.read"
  | "filesystem.write"
  | "filesystem.delete"
  | "filesystem.delete.recursive"

type CanonicalizationMode = "existing" | "leaf-may-be-missing" | "directory-entry"

const authorizeFilesystemPath = (
  adapter: FilesystemAdapter,
  permissions: FilesystemPermissionPolicy,
  path: string,
  capability: FilesystemCapability,
  operation: string,
  mode: CanonicalizationMode
): Effect.Effect<string, FilesystemError, never> =>
  Effect.gen(function* () {
    const canonicalPath = yield* canonicalizePath(adapter, path, operation, mode)
    const roots = yield* canonicalizePermissionRoots(
      adapter,
      permissionRoots(permissions, capability),
      operation
    )
    const allowedByRoot = roots.some((root) => pathWithinRoot(canonicalPath, root))
    const allowed =
      capability === "filesystem.delete.recursive"
        ? allowedByRoot && permissions.allowRecursiveRemove === true
        : allowedByRoot

    if (!allowedByRoot) {
      const requestedPath = yield* canonicalizeRequestedPath(adapter, path, operation)
      if (roots.some((root) => pathWithinRoot(requestedPath, root))) {
        return yield* Effect.fail(
          makeSymlinkEscapesRootError(path, canonicalPath, roots, operation)
        )
      }
    }

    if (!allowed) {
      return yield* Effect.fail(
        makeFilesystemPermissionDenied(capability, canonicalPath, operation)
      )
    }

    yield* denyEscapingHardLink(adapter, path, canonicalPath, roots, operation)

    return canonicalPath
  })

const denyEscapingHardLink = (
  adapter: FilesystemAdapter,
  requestedPath: string,
  canonicalPath: string,
  capabilityRoots: readonly string[],
  operation: string
): Effect.Effect<void, FilesystemError, never> =>
  Effect.gen(function* () {
    const stats = yield* Effect.tryPromise({
      try: () => adapter.stat(canonicalPath),
      catch: (error) => error
    }).pipe(
      Effect.catch((error) => {
        if (isNodeError(error) && error.code === "ENOENT") {
          return Effect.succeed(undefined)
        }
        return Effect.fail(mapFilesystemError(error, canonicalPath, operation))
      })
    )

    if (stats !== undefined && stats.isFile() && stats.nlink > 1) {
      yield* Effect.fail(
        makeSymlinkEscapesRootError(requestedPath, canonicalPath, capabilityRoots, operation)
      )
    }
  })

const canonicalizePath = (
  adapter: FilesystemAdapter,
  path: string,
  operation: string,
  mode: CanonicalizationMode
): Effect.Effect<string, FilesystemError, never> =>
  mode === "directory-entry"
    ? canonicalizeDirectoryEntry(adapter, path, operation)
    : Effect.tryPromise({
        try: () => adapter.realpath(path),
        catch: (error) => error
      }).pipe(
        Effect.catch((error) => {
          if (mode === "leaf-may-be-missing" && isNodeError(error) && error.code === "ENOENT") {
            return canonicalizePossiblyMissingPath(adapter, path, operation)
          }
          return Effect.fail(mapFilesystemError(error, path, operation))
        })
      )

const canonicalizeDirectoryEntry = (
  adapter: FilesystemAdapter,
  path: string,
  operation: string
): Effect.Effect<string, FilesystemError, never> =>
  Effect.tryPromise({
    try: async () => join(await adapter.realpath(dirname(path)), pathSegment(path)),
    catch: (error) => mapFilesystemError(error, path, operation)
  })

const canonicalizePossiblyMissingPath = (
  adapter: FilesystemAdapter,
  path: string,
  operation: string
): Effect.Effect<string, FilesystemError, never> =>
  Effect.tryPromise({
    try: () => adapter.realpath(path),
    catch: (error) => error
  }).pipe(
    Effect.catch((error) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        const parent = dirname(path)
        if (parent === path) {
          return Effect.fail(mapFilesystemError(error, path, operation))
        }
        return canonicalizePossiblyMissingPath(adapter, parent, operation).pipe(
          Effect.map((canonicalParent) => join(canonicalParent, pathSegment(path)))
        )
      }
      return Effect.fail(mapFilesystemError(error, path, operation))
    })
  )

const canonicalizeRequestedPath = (
  adapter: FilesystemAdapter,
  path: string,
  operation: string
): Effect.Effect<string, FilesystemError, never> =>
  Effect.tryPromise({
    try: async () => join(await adapter.realpath(dirname(path)), pathSegment(path)),
    catch: (error) => error
  }).pipe(
    Effect.catch((error) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return canonicalizePossiblyMissingPath(adapter, path, operation)
      }
      return Effect.fail(mapFilesystemError(error, path, operation))
    })
  )

const canonicalizePermissionRoots = (
  adapter: FilesystemAdapter,
  roots: readonly string[],
  operation: string
): Effect.Effect<readonly string[], FilesystemError, never> =>
  Effect.forEach(roots, (root) =>
    Effect.tryPromise({
      try: () => adapter.realpath(root),
      catch: (error) => mapFilesystemError(error, root, operation)
    })
  )

const permissionRoots = (
  permissions: FilesystemPermissionPolicy,
  capability: FilesystemCapability
): readonly string[] => {
  switch (capability) {
    case "filesystem.read":
      return permissions.readRoots ?? []
    case "filesystem.write":
      return permissions.writeRoots ?? []
    case "filesystem.delete":
    case "filesystem.delete.recursive":
      return permissions.deleteRoots ?? []
  }
}

const pathWithinRoot = (path: string, root: string): boolean =>
  path === root ||
  path.startsWith(root.endsWith("/") || root.endsWith("\\") ? root : `${root}/`) ||
  path.startsWith(root.endsWith("/") || root.endsWith("\\") ? root : `${root}\\`)

const pathSegment = (path: string): string => {
  const normalized = path.replaceAll("\\", "/")
  return normalized.slice(normalized.lastIndexOf("/") + 1)
}

const makeFilesystemPermissionDenied = (
  capability: FilesystemCapability,
  resource: string,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability,
    resource,
    ...common("PermissionDenied", `permission denied: ${resource}`, operation)
  })

const makeSymlinkEscapesRootError = (
  requestedPath: string,
  resolvedPath: string,
  capabilityRoots: readonly string[],
  operation: string
): HostProtocolSymlinkEscapesRootError =>
  new HostProtocolSymlinkEscapesRootError({
    tag: "SymlinkEscapesRoot",
    requested: requestedPath,
    resolved: resolvedPath,
    capabilityRoots: [...capabilityRoots],
    ...common(
      "SymlinkEscapesRoot",
      `symlink escapes capability root: ${requestedPath} -> ${resolvedPath}`,
      operation
    )
  })

const handleWatchEvent = (
  queue: Queue.Queue<FilesystemEvent, FilesystemError | Cause.Done>,
  adapter: FilesystemAdapter,
  directory: string,
  event: RawFilesystemEvent
): Effect.Effect<void, never, never> => {
  const filename = event.filename
  const path = filename === undefined ? directory : appendWatchPathSegment(directory, filename)

  return Effect.gen(function* () {
    const kind = yield* classifyWatchEvent(adapter, path, event)
    yield* Queue.offer(
      queue,
      new FilesystemEvent({
        kind,
        path,
        directory,
        ...(filename === undefined ? {} : { filename })
      })
    )
  }).pipe(
    Effect.catch((error: FilesystemError) => Queue.fail(queue, error)),
    Effect.asVoid
  )
}

const classifyWatchEvent = (
  adapter: FilesystemAdapter,
  path: string,
  event: RawFilesystemEvent
): Effect.Effect<FilesystemEventKind, FilesystemError, never> => {
  if (event.type === "change") {
    return Effect.succeed("modified")
  }
  if (event.filename === undefined) {
    return Effect.succeed("renamed")
  }

  return Effect.tryPromise({
    try: () => adapter.stat(path),
    catch: (error) => error
  }).pipe(
    Effect.as("created" as const),
    Effect.catch((error) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return Effect.succeed("deleted" as const)
      }
      return Effect.fail(mapFilesystemError(error, path, "Filesystem.watch"))
    })
  )
}

const appendWatchPathSegment = (directory: string, filename: string): string => {
  if (directory.endsWith("/") || directory.endsWith("\\")) {
    return `${directory}${filename}`
  }
  return `${directory}${directory.includes("\\") && !directory.includes("/") ? "\\" : "/"}${filename}`
}

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
  tag: "FileNotFound" | "PermissionDenied" | "DiskFull" | "SymlinkEscapesRoot",
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
