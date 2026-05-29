---
title: Filesystem
description: Permissioned filesystem service with declared roots and scoped handles.
kind: reference
audience: app-developers
effect_version: 4
---

# `Filesystem`

Runtime filesystem service. Enforces root containment, binds handles to the `ResourceOwner` in the layer graph, and returns typed failures.

> Note: this is `@orika/core`'s `Filesystem`, distinct from Effect's `FileSystem` from `effect/platform`.

## Import

```ts
import {
  Filesystem,
  FilesystemLive,
  makeFilesystem,
  type FilesystemApi,
  type FilesystemError,
  type FilesystemEvent,
  type FilesystemOptions,
  type FilesystemPermissionPolicy,
  type FilesystemStatResult
} from "@orika/core"
```

`FilesystemError` is the bridge's `HostProtocolError` union; see [`reference/errors.md`](../errors.md).

## API

| Method        | Signature                                                             |
| ------------- | --------------------------------------------------------------------- |
| `read`        | `(path) => Effect<Uint8Array, FilesystemError>`                       |
| `realpath`    | `(path, capability?) => Effect<string, FilesystemError>`              |
| `write`       | `(path, bytes) => Effect<void, FilesystemError>`                      |
| `writeAtomic` | `(path, bytes) => Effect<void, FilesystemError>`                      |
| `stat`        | `(path) => Effect<FilesystemStatResult, FilesystemError>`             |
| `mkdir`       | `(path, { recursive? }) => Effect<void, FilesystemError>`             |
| `remove`      | `(path, { recursive? }) => Effect<void, FilesystemError>`             |
| `watch`       | `(path, { bufferSize? }) => Stream<FilesystemEvent, FilesystemError>` |

`writeAtomic` writes through a sibling `*.tmp.<uuid>` file and renames into place; an interrupted write removes the temp. `read`/`write` go through `effect/FileSystem` directly. Watchers register a scoped resource with the `ResourceRegistry` that closes with the scope.

`FilesystemStatResult` carries `{ path, kind, sizeBytes, modifiedAtMs }`, where `kind` is `"file" | "directory" | "symlink" | "other"`. Symlinks are not followed by `stat`; `realpath` resolves them and the optional `capability` argument controls whether the resolution is authorized as a read or a write.

`FilesystemEvent` carries `{ kind, path, directory, filename? }`, where `kind` is `"created" | "modified" | "deleted" | "renamed"`. The watcher buffers events with a sliding strategy (default 1024).

## Errors

`FilesystemError` is the `HostProtocolError` union:

- `HostProtocolPermissionDeniedError` — path is outside every declared root, or its symlink target escapes the root. Recursive `remove` additionally requires `allowRecursiveRemove: true` in the permission policy.
- `HostProtocolSymlinkEscapesRootError` — the requested path is inside a permitted root but its resolved target is not.
- `HostProtocolFileNotFoundError` — `ENOENT` or `NotFound` for read, stat, watch.
- `HostProtocolDiskFullError` — `ENOSPC` on write or atomic write (`recoverable: true`).
- `HostProtocolInvalidArgumentError` — malformed path, non-decoding input, or other unmappable OS error.

## Permissions

`FilesystemPermissionPolicy` declares roots per capability:

```ts
type FilesystemPermissionPolicy = {
  readonly readRoots?: readonly string[]
  readonly writeRoots?: readonly string[]
  readonly deleteRoots?: readonly string[]
  readonly allowRecursiveRemove?: boolean
}
```

Capabilities applied per operation: `filesystem.read` (read, stat, realpath default, watch), `filesystem.write` (write, writeAtomic, mkdir), `filesystem.delete` (non-recursive remove), `filesystem.delete.recursive` (recursive remove). All roots are canonicalized via `realPath` before containment checks. See [How-to: declare a permission](../../how-to/declare-a-permission.md).

## Layer

`FilesystemLive` is a `Layer<Filesystem, never, ResourceOwner | ResourceRegistry | effect/FileSystem | effect/Path>`. It defaults to an empty permission policy and the disabled inspector collector; build a custom layer with `makeFilesystem(registry, owner, options)` when you need a non-empty `FilesystemPermissionPolicy`, a custom `FilesystemInspectorCollectorApi`, or a clock override. `Desktop.runtime(...)` provides an app owner, `Desktop.window(..., services)` provides a window owner, and tests can provide `ResourceOwner.test(...)`.

## Example

```ts
const fs = yield * Filesystem
const bytes = yield * fs.read("/Users/me/Documents/notes.md")
```

## Test layer

`MemoryFilesystem.layer(options)` from `@orika/test`.

## Related

- How-to: [Read and write files](../../how-to/read-write-files.md)
- Reference: [`MemoryFilesystem`](../test/memory-filesystem.md)
- Source: [`packages/core/src/runtime/filesystem.ts`](../../../packages/core/src/runtime/filesystem.ts)
