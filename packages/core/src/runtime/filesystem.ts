import { dirname, join, resolve } from "node:path"
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
import {
  Clock,
  Context,
  Effect,
  Exit,
  Fiber,
  FileSystem as EffectFileSystem,
  Layer,
  Option,
  Queue,
  Schema,
  Stream
} from "effect"
import type { PlatformError } from "effect/PlatformError"

import { ResourceRegistry, type ResourceRegistryApi } from "./resources.js"
import { ResourceOwner, type ResourceOwnerApi } from "./resource-owner.js"
import {
  disabledFilesystemInspectorCollector,
  FilesystemInspectorEvent,
  type FilesystemInspectorCollectorApi
} from "./inspector-events.js"

// eslint-disable-next-line no-control-regex -- Native filesystem paths cannot contain NUL.
const FilesystemPathString = Schema.NonEmptyString.check(Schema.isPattern(/^[^\x00]+$/u))
const NonEmptyPath = Schema.NonEmptyString
// eslint-disable-next-line no-control-regex -- Native watch filenames cannot contain control bytes.
const WatchEventFilename = Schema.String.check(Schema.isPattern(/^[^\x00-\x1f\x7f]*$/u))

export class FilesystemPathInput extends Schema.Class<FilesystemPathInput>("FilesystemPathInput")({
  path: FilesystemPathString
}) {}

export const FilesystemPathCapability = Schema.Literals(["filesystem.read", "filesystem.write"])
export type FilesystemPathCapability = typeof FilesystemPathCapability.Type

export class FilesystemRealpathInput extends Schema.Class<FilesystemRealpathInput>(
  "FilesystemRealpathInput"
)({
  path: FilesystemPathString,
  capability: Schema.optionalKey(FilesystemPathCapability)
}) {}

export class FilesystemWriteInput extends Schema.Class<FilesystemWriteInput>(
  "FilesystemWriteInput"
)({
  path: FilesystemPathString,
  bytes: Schema.Uint8Array
}) {}

export class FilesystemMkdirInput extends Schema.Class<FilesystemMkdirInput>(
  "FilesystemMkdirInput"
)({
  path: FilesystemPathString,
  recursive: Schema.optionalKey(Schema.Boolean)
}) {}

export class FilesystemRemoveInput extends Schema.Class<FilesystemRemoveInput>(
  "FilesystemRemoveInput"
)({
  path: FilesystemPathString,
  recursive: Schema.optionalKey(Schema.Boolean)
}) {}

export class FilesystemWatchInput extends Schema.Class<FilesystemWatchInput>(
  "FilesystemWatchInput"
)({
  path: FilesystemPathString,
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
    options?: { readonly bufferSize?: number }
  ) => Stream.Stream<FilesystemEvent, FilesystemError, never>
}

export interface FilesystemPermissionPolicy {
  readonly readRoots?: readonly string[]
  readonly writeRoots?: readonly string[]
  readonly deleteRoots?: readonly string[]
  readonly allowRecursiveRemove?: boolean
}

export interface FilesystemOptions {
  readonly inspector?: FilesystemInspectorCollectorApi
  readonly permissions?: FilesystemPermissionPolicy
  readonly now?: () => number
}

export const makeFilesystem = (
  registry: ResourceRegistryApi,
  owner: ResourceOwnerApi,
  options: FilesystemOptions = {}
): Effect.Effect<FilesystemApi, never, EffectFileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* EffectFileSystem.FileSystem
    const permissions = options.permissions ?? EMPTY_FILESYSTEM_PERMISSIONS
    const inspector = options.inspector ?? disabledFilesystemInspectorCollector
    const clock = yield* Clock.Clock
    const now = options.now ?? (() => clock.currentTimeMillisUnsafe())

    return Object.freeze({
      read: (path: string) =>
        Effect.gen(function* () {
          const input = yield* decodePathInput({ path }, "Filesystem.read")
          const authorizedPath = yield* authorizeFilesystemPath(
            fileSystem,
            permissions,
            input.path,
            "filesystem.read",
            "Filesystem.read",
            "existing"
          )
          const bytes = yield* fileSystem
            .readFile(authorizedPath)
            .pipe(
              Effect.mapError((error) =>
                mapFilesystemError(error, authorizedPath, "Filesystem.read")
              )
            )
          yield* publishFilesystemOperation(inspector, now, "Filesystem.read", "success", {
            path: authorizedPath
          })
          return bytes
        }).pipe(Effect.withSpan("Filesystem.read", { attributes: { path } })),
      realpath: (path: string, capability?: FilesystemPathCapability) =>
        Effect.gen(function* () {
          const input = yield* decodeRealpathInput(
            { path, ...(capability === undefined ? {} : { capability }) },
            "Filesystem.realpath"
          )
          return yield* authorizeFilesystemPath(
            fileSystem,
            permissions,
            input.path,
            input.capability ?? "filesystem.read",
            "Filesystem.realpath",
            "existing"
          )
        }).pipe(
          Effect.withSpan("Filesystem.realpath", {
            attributes: { path, capability: capability ?? "filesystem.read" }
          })
        ),
      write: (path: string, bytes: Uint8Array) =>
        Effect.gen(function* () {
          const input = yield* decodeWriteInput({ path, bytes }, "Filesystem.write")
          const authorizedPath = yield* authorizeFilesystemPath(
            fileSystem,
            permissions,
            input.path,
            "filesystem.write",
            "Filesystem.write",
            "leaf-may-be-missing"
          )
          yield* fileSystem
            .writeFile(authorizedPath, input.bytes)
            .pipe(
              Effect.mapError((error) =>
                mapFilesystemError(error, authorizedPath, "Filesystem.write")
              )
            )
          yield* publishFilesystemOperation(inspector, now, "Filesystem.write", "success", {
            path: authorizedPath
          })
        }).pipe(Effect.withSpan("Filesystem.write", { attributes: { path } })),
      writeAtomic: (path: string, bytes: Uint8Array) =>
        Effect.gen(function* () {
          const input = yield* decodeWriteInput({ path, bytes }, "Filesystem.writeAtomic")
          const authorizedPath = yield* authorizeFilesystemPath(
            fileSystem,
            permissions,
            input.path,
            "filesystem.write",
            "Filesystem.writeAtomic",
            "directory-entry"
          )
          yield* writeAtomicFile(fileSystem, authorizedPath, input.bytes)
          yield* publishFilesystemOperation(inspector, now, "Filesystem.writeAtomic", "success", {
            path: authorizedPath
          })
        }).pipe(Effect.withSpan("Filesystem.writeAtomic", { attributes: { path } })),
      stat: (path: string) =>
        Effect.gen(function* () {
          const input = yield* decodePathInput({ path }, "Filesystem.stat")
          const authorizedPath = yield* authorizeFilesystemPath(
            fileSystem,
            permissions,
            input.path,
            "filesystem.read",
            "Filesystem.stat",
            "stat"
          )
          const result = yield* statFilesystemPath(fileSystem, authorizedPath)
          yield* publishFilesystemOperation(inspector, now, "Filesystem.stat", "success", {
            path: authorizedPath
          })
          return result
        }).pipe(Effect.withSpan("Filesystem.stat", { attributes: { path } })),
      mkdir: (path: string, options?: { readonly recursive?: boolean }) =>
        Effect.gen(function* () {
          const input = yield* decodeMkdirInput(
            { path, ...(options?.recursive === undefined ? {} : { recursive: options.recursive }) },
            "Filesystem.mkdir"
          )
          const authorizedPath = yield* authorizeFilesystemPath(
            fileSystem,
            permissions,
            input.path,
            "filesystem.write",
            "Filesystem.mkdir",
            "leaf-may-be-missing"
          )
          yield* fileSystem
            .makeDirectory(authorizedPath, { recursive: input.recursive === true })
            .pipe(
              Effect.mapError((error) =>
                mapFilesystemError(error, authorizedPath, "Filesystem.mkdir")
              )
            )
          yield* publishFilesystemOperation(inspector, now, "Filesystem.mkdir", "success", {
            path: authorizedPath
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
            fileSystem,
            permissions,
            input.path,
            capability,
            "Filesystem.remove",
            "directory-entry"
          )
          yield* removeFilesystemPath(
            fileSystem,
            authorizedPath,
            input.recursive === true,
            capability
          )
          yield* publishFilesystemOperation(inspector, now, "Filesystem.remove", "success", {
            path: authorizedPath
          })
        }).pipe(Effect.withSpan("Filesystem.remove", { attributes: { path } })),
      watch: (path: string, options?: { readonly bufferSize?: number }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const input = yield* decodeWatchInput(
              {
                path,
                ownerScope: owner.scopeId,
                ...(options === undefined ? {} : options)
              },
              "Filesystem.watch"
            )
            const authorizedPath = yield* authorizeFilesystemPath(
              fileSystem,
              permissions,
              input.path,
              "filesystem.read",
              "Filesystem.watch",
              "existing"
            )
            const bufferSize = input.bufferSize ?? DEFAULT_WATCH_BUFFER_SIZE

            return Stream.callback<FilesystemEvent, FilesystemError>(
              (queue) =>
                Effect.acquireRelease(
                  Effect.gen(function* () {
                    const watchFiber = yield* fileSystem.watch(authorizedPath).pipe(
                      Stream.runForEach((event) =>
                        makeWatchEvent(fileSystem, authorizedPath, event).pipe(
                          Effect.tap((filesystemEvent) =>
                            inspector.publish(
                              new FilesystemInspectorEvent({
                                kind: "watch",
                                status: "success",
                                operation: "Filesystem.watch",
                                ownerScope: input.ownerScope,
                                path: filesystemEvent.path,
                                directory: filesystemEvent.directory,
                                eventKind: filesystemEvent.kind,
                                ...(filesystemEvent.filename === undefined
                                  ? {}
                                  : { message: filesystemEvent.filename }),
                                timestamp: now()
                              })
                            )
                          ),
                          Effect.flatMap((filesystemEvent) => Queue.offer(queue, filesystemEvent))
                        )
                      ),
                      Effect.catch((error) => {
                        const filesystemError = isPlatformError(error)
                          ? mapFilesystemError(error, authorizedPath, "Filesystem.watch")
                          : error
                        return inspector
                          .publish(
                            new FilesystemInspectorEvent({
                              kind: "watch",
                              status: "failure",
                              operation: "Filesystem.watch",
                              ownerScope: input.ownerScope,
                              path: authorizedPath,
                              errorTag: filesystemError._tag,
                              message: filesystemError.message,
                              timestamp: now()
                            })
                          )
                          .pipe(Effect.andThen(Queue.fail(queue, filesystemError)))
                      }),
                      Effect.andThen(Queue.end(queue)),
                      Effect.forkScoped
                    )
                    const handle = yield* registry
                      .register({
                        kind: "filesystem-watch",
                        ownerScope: input.ownerScope,
                        state: "open",
                        dispose: Fiber.interrupt(watchFiber).pipe(Effect.andThen(Queue.end(queue)))
                      })
                      .pipe(Effect.orDie)
                    yield* inspector.publish(
                      new FilesystemInspectorEvent({
                        kind: "watch",
                        status: "start",
                        operation: "Filesystem.watch",
                        ownerScope: input.ownerScope,
                        path: authorizedPath,
                        resourceId: handle.id,
                        timestamp: now()
                      })
                    )
                    return handle
                  }),
                  (handle) =>
                    registry.dispose(handle.id).pipe(
                      Effect.andThen(
                        inspector.publish(
                          new FilesystemInspectorEvent({
                            kind: "watch",
                            status: "cleanup",
                            operation: "Filesystem.watch",
                            ownerScope: input.ownerScope,
                            path: authorizedPath,
                            resourceId: handle.id,
                            timestamp: now()
                          })
                        )
                      )
                    )
                ),
              { bufferSize, strategy: "sliding" }
            )
          }).pipe(Effect.withSpan("Filesystem.watch", { attributes: { path } }))
        )
    })
  })

export class Filesystem extends Context.Service<Filesystem, FilesystemApi>()(
  "@effect-desktop/core/runtime/filesystem"
) {}

export const FilesystemLive: Layer.Layer<
  Filesystem,
  never,
  ResourceOwner | ResourceRegistry | EffectFileSystem.FileSystem
> = Layer.effect(Filesystem)(
  Effect.gen(function* () {
    const owner = yield* ResourceOwner
    const registry = yield* ResourceRegistry
    return yield* makeFilesystem(registry, owner)
  })
)

const DEFAULT_WATCH_BUFFER_SIZE = 1_024
const EMPTY_FILESYSTEM_PERMISSIONS: FilesystemPermissionPolicy = Object.freeze({})

const publishFilesystemOperation = (
  inspector: FilesystemInspectorCollectorApi,
  now: () => number,
  operation: string,
  status: "success",
  options: {
    readonly path: string
  }
): Effect.Effect<void, never, never> =>
  inspector.publish(
    new FilesystemInspectorEvent({
      kind: "operation",
      status,
      operation,
      path: options.path,
      timestamp: now()
    })
  )

const writeAtomicFile = (
  fileSystem: EffectFileSystem.FileSystem,
  path: string,
  bytes: Uint8Array
): Effect.Effect<void, FilesystemError, never> => {
  const tempPath = makeAtomicTempPath(path)
  let committed = false

  return Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fileSystem
          .open(tempPath, { flag: "w" })
          .pipe(
            Effect.mapError((error) => mapFilesystemError(error, path, "Filesystem.writeAtomic"))
          )
        yield* file
          .writeAll(bytes)
          .pipe(
            Effect.mapError((error) => mapFilesystemError(error, path, "Filesystem.writeAtomic"))
          )
        yield* file.sync.pipe(
          Effect.mapError((error) => mapFilesystemError(error, path, "Filesystem.writeAtomic"))
        )
      })
    )
    yield* fileSystem
      .rename(tempPath, path)
      .pipe(Effect.mapError((error) => mapFilesystemError(error, path, "Filesystem.writeAtomic")))
    yield* Effect.sync(() => {
      committed = true
    })
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        if (!committed) {
          const cleanup = yield* Effect.exit(cleanupAtomicTemp(fileSystem, tempPath))
          if (Exit.isFailure(cleanup)) {
            yield* Effect.logWarning("Filesystem.writeAtomic temp cleanup failed", {
              operation: "Filesystem.writeAtomic",
              path,
              tempPath,
              cause: String(cleanup.cause)
            })
          }
        }
      })
    )
  )
}

const cleanupAtomicTemp = (
  fileSystem: EffectFileSystem.FileSystem,
  tempPath: string
): Effect.Effect<void, PlatformError, never> =>
  fileSystem.remove(tempPath, { force: true }).pipe(
    Effect.catch((error) => (isNotFoundPlatformError(error) ? Effect.void : Effect.fail(error)))
  )

const makeAtomicTempPath = (path: string): string => `${path}.tmp.${randomUUID()}`

const statFilesystemPath = (
  fileSystem: EffectFileSystem.FileSystem,
  path: string
): Effect.Effect<FilesystemStatResult, FilesystemError, never> =>
  Effect.gen(function* () {
    const isSymlink = yield* pathIsSymlink(fileSystem, path, "Filesystem.stat")
    if (isSymlink) {
      return new FilesystemStatResult({
        path,
        kind: "symlink",
        sizeBytes: 0,
        modifiedAtMs: 0
      })
    }

    const result = yield* fileSystem
      .stat(path)
      .pipe(Effect.mapError((error) => mapFilesystemError(error, path, "Filesystem.stat")))

    return new FilesystemStatResult({
      path,
      kind: statKind(result),
      sizeBytes: Number(result.size),
      modifiedAtMs: modifiedAtMs(result)
    })
  })

const removeFilesystemPath = (
  fileSystem: EffectFileSystem.FileSystem,
  path: string,
  recursive: boolean,
  capability: FilesystemCapability
): Effect.Effect<void, FilesystemError, never> =>
  fileSystem.remove(path, { recursive }).pipe(
    Effect.catch((error) => {
      if (recursive) {
        return Effect.fail(mapFilesystemError(error, path, "Filesystem.remove", capability))
      }

      return fileSystem.readDirectory(path).pipe(
        Effect.flatMap((entries) =>
          entries.length === 0
            ? fileSystem
                .remove(path, { recursive: true })
                .pipe(
                  Effect.mapError((fallbackError) =>
                    mapFilesystemError(fallbackError, path, "Filesystem.remove", capability)
                  )
                )
            : Effect.fail(mapFilesystemError(error, path, "Filesystem.remove", capability))
        ),
        Effect.mapError(() => mapFilesystemError(error, path, "Filesystem.remove", capability))
      )
    })
  )

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

const decodeRealpathInput = (
  input: unknown,
  operation: string
): Effect.Effect<FilesystemRealpathInput, HostProtocolInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(FilesystemRealpathInput)(input).pipe(
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

type CanonicalizationMode = "existing" | "leaf-may-be-missing" | "directory-entry" | "stat"

const authorizeFilesystemPath = (
  fileSystem: EffectFileSystem.FileSystem,
  permissions: FilesystemPermissionPolicy,
  path: string,
  capability: FilesystemCapability,
  operation: string,
  mode: CanonicalizationMode
): Effect.Effect<string, FilesystemError, never> =>
  Effect.gen(function* () {
    const canonicalPath = yield* canonicalizePath(fileSystem, path, operation, mode)
    const roots = yield* canonicalizePermissionRoots(
      fileSystem,
      permissionRoots(permissions, capability),
      operation
    )
    const allowedByRoot = roots.some((root) => pathWithinRoot(canonicalPath, root))
    const allowed =
      capability === "filesystem.delete.recursive"
        ? allowedByRoot && permissions.allowRecursiveRemove === true
        : allowedByRoot

    if (!allowedByRoot) {
      const requestedPathWithinRoots = yield* requestedPathWithinPermissionRoots(
        fileSystem,
        path,
        roots
      )
      if (requestedPathWithinRoots) {
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

    yield* denyEscapingHardLink(fileSystem, path, canonicalPath, roots, operation)

    return canonicalPath
  })

const denyEscapingHardLink = (
  fileSystem: EffectFileSystem.FileSystem,
  requestedPath: string,
  canonicalPath: string,
  capabilityRoots: readonly string[],
  operation: string
): Effect.Effect<void, FilesystemError, never> =>
  Effect.gen(function* () {
    if (yield* pathIsSymlink(fileSystem, canonicalPath, operation)) {
      return
    }

    const stats = yield* fileSystem.stat(canonicalPath).pipe(
      Effect.catch((error) => {
        if (isNotFoundPlatformError(error)) {
          return Effect.succeed(undefined)
        }
        return Effect.fail(mapFilesystemError(error, canonicalPath, operation))
      })
    )

    if (
      stats !== undefined &&
      stats.type === "File" &&
      Option.getOrElse(stats.nlink, () => 1) > 1
    ) {
      return yield* Effect.fail(
        makeSymlinkEscapesRootError(requestedPath, canonicalPath, capabilityRoots, operation)
      )
    }
  })

const canonicalizePath = (
  fileSystem: EffectFileSystem.FileSystem,
  path: string,
  operation: string,
  mode: CanonicalizationMode
): Effect.Effect<string, FilesystemError, never> =>
  mode === "directory-entry"
    ? canonicalizeDirectoryEntry(fileSystem, path, operation)
    : mode === "stat"
      ? canonicalizeStatPath(fileSystem, path, operation)
      : fileSystem.realPath(path).pipe(
          Effect.catch((error) => {
            if (mode === "leaf-may-be-missing" && isNotFoundPlatformError(error)) {
              return canonicalizePossiblyMissingPath(fileSystem, path, operation)
            }
            return Effect.fail(mapFilesystemError(error, path, operation))
          })
        )

const canonicalizeStatPath = (
  fileSystem: EffectFileSystem.FileSystem,
  path: string,
  operation: string
): Effect.Effect<string, FilesystemError, never> =>
  fileSystem.realPath(dirname(path)).pipe(
    Effect.map((parent) => join(parent, pathSegment(path))),
    Effect.mapError((error) => mapFilesystemError(error, path, operation))
  )

const canonicalizeDirectoryEntry = (
  fileSystem: EffectFileSystem.FileSystem,
  path: string,
  operation: string
): Effect.Effect<string, FilesystemError, never> =>
  fileSystem.realPath(dirname(path)).pipe(
    Effect.map((parent) => join(parent, pathSegment(path))),
    Effect.mapError((error) => mapFilesystemError(error, path, operation))
  )

const canonicalizePossiblyMissingPath = (
  fileSystem: EffectFileSystem.FileSystem,
  path: string,
  operation: string
): Effect.Effect<string, FilesystemError, never> =>
  fileSystem.realPath(path).pipe(
    Effect.catch((error) => {
      if (isNotFoundPlatformError(error)) {
        const parent = dirname(path)
        if (parent === path) {
          return Effect.fail(mapFilesystemError(error, path, operation))
        }
        return canonicalizePossiblyMissingPath(fileSystem, parent, operation).pipe(
          Effect.map((canonicalParent) => join(canonicalParent, pathSegment(path)))
        )
      }
      return Effect.fail(mapFilesystemError(error, path, operation))
    })
  )

const requestedPathWithinPermissionRoots = (
  fileSystem: EffectFileSystem.FileSystem,
  path: string,
  roots: readonly string[]
): Effect.Effect<boolean, never, never> =>
  requestedAncestorWithinPermissionRoots(fileSystem, dirname(resolve(path)), roots)

const requestedAncestorWithinPermissionRoots = (
  fileSystem: EffectFileSystem.FileSystem,
  path: string,
  roots: readonly string[]
): Effect.Effect<boolean, never, never> =>
  fileSystem.realPath(path).pipe(
    Effect.map((canonicalPath) => roots.some((root) => pathWithinRoot(canonicalPath, root))),
    Effect.catch((error) => {
      if (isNotFoundPlatformError(error) || isPermissionDeniedPlatformError(error)) {
        return Effect.succeed(false)
      }
      return Effect.succeed(false)
    }),
    Effect.flatMap((withinRoots) => {
      if (withinRoots) {
        return Effect.succeed(true)
      }
      const parent = dirname(path)
      return parent === path
        ? Effect.succeed(false)
        : requestedAncestorWithinPermissionRoots(fileSystem, parent, roots)
    })
  )

const canonicalizePermissionRoots = (
  fileSystem: EffectFileSystem.FileSystem,
  roots: readonly string[],
  operation: string
): Effect.Effect<readonly string[], FilesystemError, never> =>
  Effect.forEach(roots, (root) =>
    fileSystem
      .realPath(root)
      .pipe(Effect.mapError((error) => mapFilesystemError(error, root, operation)))
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

const makeWatchEvent = (
  fileSystem: EffectFileSystem.FileSystem,
  directory: string,
  event: EffectFileSystem.WatchEvent
): Effect.Effect<FilesystemEvent, FilesystemError, never> =>
  Effect.gen(function* () {
    const path = watchEventPath(directory, event.path)
    const filename =
      path === directory ? undefined : yield* decodeWatchEventFilename(pathSegment(path))
    return new FilesystemEvent({
      kind: yield* classifyWatchEvent(fileSystem, path, event),
      path,
      directory,
      ...(filename === undefined ? {} : { filename })
    })
  })

const decodeWatchEventFilename = (
  filename: string
): Effect.Effect<string, HostProtocolInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(WatchEventFilename)(filename).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError(
        "filename",
        formatUnknownError(error),
        "Filesystem.watch"
      )
    )
  )

const classifyWatchEvent = (
  fileSystem: EffectFileSystem.FileSystem,
  path: string,
  event: EffectFileSystem.WatchEvent
): Effect.Effect<FilesystemEventKind, FilesystemError, never> => {
  if (event._tag === "Update") {
    return Effect.succeed("modified")
  }

  return fileSystem.stat(path).pipe(
    Effect.as("created" as const),
    Effect.catch((error) => {
      if (isNotFoundPlatformError(error)) {
        return Effect.succeed("deleted" as const)
      }
      return Effect.fail(mapFilesystemError(error, path, "Filesystem.watch"))
    })
  )
}

const watchEventPath = (directory: string, path: string): string =>
  path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/u.test(path)
    ? path
    : appendWatchPathSegment(directory, path)

const appendWatchPathSegment = (directory: string, filename: string): string => {
  if (directory.endsWith("/") || directory.endsWith("\\")) {
    return `${directory}${filename}`
  }
  return `${directory}${directory.includes("\\") && !directory.includes("/") ? "\\" : "/"}${filename}`
}

const statKind = (stats: EffectFileSystem.File.Info): FilesystemEntryKind => {
  if (stats.type === "File") {
    return "file"
  }
  if (stats.type === "Directory") {
    return "directory"
  }
  return "other"
}

const pathIsSymlink = (
  fileSystem: EffectFileSystem.FileSystem,
  path: string,
  operation: string
): Effect.Effect<boolean, FilesystemError, never> =>
  fileSystem.readLink(path).pipe(
    Effect.as(true),
    Effect.catch((error) =>
      isNotSymlinkPlatformError(error)
        ? Effect.succeed(false)
        : Effect.fail(mapFilesystemError(error, path, operation))
    )
  )

const modifiedAtMs = (stats: EffectFileSystem.File.Info): number =>
  Option.match(stats.mtime, {
    onNone: () => 0,
    onSome: (date) => date.getTime()
  })

const mapFilesystemError = (
  error: unknown,
  path: string,
  operation: string,
  capability?: FilesystemCapability
): HostProtocolError => {
  if (isPlatformError(error)) {
    const reason = error.reason
    const cause = "cause" in reason ? reason.cause : undefined
    const code = nodeErrorCode(cause)
    if (code === "ENOSPC") {
      return new HostProtocolDiskFullError({
        tag: "DiskFull",
        path,
        freeBytes: 0,
        code,
        cause: sanitizeUnknownCause(cause),
        ...common("DiskFull", `disk full while accessing: ${path}`, operation)
      })
    }
    if (code === "EACCES" || code === "EPERM") {
      return new HostProtocolPermissionDeniedError({
        tag: "PermissionDenied",
        capability: capability ?? filesystemCapability(operation),
        resource: path,
        code,
        cause: sanitizeUnknownCause(cause),
        ...common("PermissionDenied", `permission denied: ${path}`, operation)
      })
    }
    if (code === "ENOENT") {
      return new HostProtocolFileNotFoundError({
        tag: "FileNotFound",
        path,
        code,
        cause: sanitizeUnknownCause(cause),
        ...common("FileNotFound", `file not found: ${path}`, operation)
      })
    }

    switch (reason._tag) {
      case "NotFound":
        return new HostProtocolFileNotFoundError({
          tag: "FileNotFound",
          path,
          ...(code === undefined ? {} : { code }),
          cause: sanitizeUnknownCause(cause),
          ...common("FileNotFound", `file not found: ${path}`, operation)
        })
      case "PermissionDenied":
        return new HostProtocolPermissionDeniedError({
          tag: "PermissionDenied",
          capability: capability ?? filesystemCapability(operation),
          resource: path,
          ...(code === undefined ? {} : { code }),
          cause: sanitizeUnknownCause(cause),
          ...common("PermissionDenied", `permission denied: ${path}`, operation)
        })
      case "BadArgument":
      case "BadResource":
      case "InvalidData":
      case "AlreadyExists":
      case "Busy":
      case "TimedOut":
      case "UnexpectedEof":
      case "Unknown":
      case "WouldBlock":
      case "WriteZero":
        return makeHostProtocolInvalidArgumentError("path", reason.message, operation)
    }
  }

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
          capability: capability ?? filesystemCapability(operation),
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
      case undefined:
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

const isPlatformError = (error: unknown): error is PlatformError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === "PlatformError" &&
  "reason" in error

const isNotFoundPlatformError = (error: unknown): boolean =>
  isPlatformError(error) && error.reason._tag === "NotFound"

const isNotSymlinkPlatformError = (error: unknown): boolean => {
  if (!isPlatformError(error)) {
    return false
  }

  if (error.reason._tag === "NotFound") {
    return true
  }

  return "cause" in error.reason && nodeErrorCode(error.reason.cause) === "EINVAL"
}

const isPermissionDeniedPlatformError = (error: unknown): boolean =>
  isPlatformError(error) && error.reason._tag === "PermissionDenied"

const nodeErrorCode = (cause: unknown): string | undefined =>
  isNodeError(cause) && typeof cause.code === "string" ? cause.code : undefined

const sanitizeNodeError = (error: NodeJS.ErrnoException): Record<string, string> => ({
  name: error.name,
  message: error.message,
  ...(error.code === undefined ? {} : { code: error.code })
})

const sanitizeUnknownCause = (cause: unknown): Record<string, string> =>
  isNodeError(cause)
    ? sanitizeNodeError(cause)
    : {
        message: formatUnknownError(cause)
      }

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
