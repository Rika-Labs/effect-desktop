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
  type FilesystemApi,
  type FilesystemOptions,
  type FilesystemPermissionPolicy,
  FilesystemPermissionDenied,
  FilesystemInvalidArgument,
  FilesystemSystemError,
  makeFilesystem
} from "@orika/core"
```

## API

| Method        | Signature                                                      |
| ------------- | -------------------------------------------------------------- |
| `read`        | `(path) => Effect<Uint8Array>`                                 |
| `realpath`    | `(path, capability?) => Effect<string>`                        |
| `write`       | `(path, bytes) => Effect<void>`                                |
| `writeAtomic` | `(path, bytes) => Effect<void>`                                |
| `stat`        | `(path) => Effect<FileStat>`                                   |
| `mkdir`       | `(path, options?) => Effect<void>`                             |
| `remove`      | `(path, options?) => Effect<void>`                             |
| `watch`       | `(path, options?) => Stream<FilesystemEvent, FilesystemError>` |

Writes are atomic via temp file + rename. Watchers register a scoped resource that closes with the scope.

## Errors

- `FilesystemPermissionDenied` — path not under a declared root.
- `FilesystemInvalidArgument` — malformed path or traversal.
- `FilesystemSystemError` — OS-level error.

## Permissions

Reads need `filesystem.read` for a containing root. Writes need `filesystem.write`. See [How-to: declare a permission](../../how-to/declare-a-permission.md).

## Layer

`FilesystemLive` and `makeFilesystem(...)` require `ResourceOwner` plus `ResourceRegistry`. `Desktop.runtime(...)` provides an app owner, `Desktop.window(..., services)` provides a window owner, and tests can provide `ResourceOwner.test(...)`.

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
