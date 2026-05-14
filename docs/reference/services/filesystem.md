---
title: Filesystem
description: Permissioned filesystem service with declared roots and scoped handles.
kind: reference
audience: app-developers
effect_version: 4
---

# `Filesystem`

Runtime filesystem service. Enforces root containment, requires an `ownerScope` on every operation, returns typed failures.

> Note: this is `@effect-desktop/core`'s `Filesystem`, distinct from Effect's `FileSystem` from `effect/platform`.

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
} from "@effect-desktop/core"
```

## API

| Method | Signature |
| --- | --- |
| `readFileString` | `({ path, ownerScope, encoding? }) => Effect<string>` |
| `readFileBytes` | `({ path, ownerScope }) => Effect<Uint8Array>` |
| `writeFileString` | `({ path, content, ownerScope, encoding? }) => Effect<void>` |
| `writeFileBytes` | `({ path, content, ownerScope }) => Effect<void>` |
| `readDirectory` | `({ path, ownerScope }) => Effect<DirectoryEntry[]>` |
| `stat` | `({ path, ownerScope }) => Effect<FileStat>` |
| `remove` | `({ path, ownerScope }) => Effect<void>` |
| `exists` | `({ path, ownerScope }) => Effect<boolean>` |
| `watch` | `({ path, ownerScope }) => Effect<Watcher>` |

Writes are atomic via temp file + rename. Watchers register a scoped resource that closes with the scope.

## Errors

- `FilesystemPermissionDenied` — path not under a declared root.
- `FilesystemInvalidArgument` — malformed path or traversal.
- `FilesystemSystemError` — OS-level error.

## Permissions

Reads need `filesystem.read` for a containing root. Writes need `filesystem.write`. See [How-to: declare a permission](../../how-to/declare-a-permission.md).

## Layer

`makeFilesystem({ ownerScope, rootScope, policy })` returns the layer.

## Example

```ts
const fs = yield* Filesystem
const text = yield* fs.readFileString({
  path: "/Users/me/Documents/notes.md",
  ownerScope: "window-main"
})
```

## Test layer

`MemoryFilesystem.layer(options)` from `@effect-desktop/test`.

## Related

- How-to: [Read and write files](../../how-to/read-write-files.md)
- Reference: [`MemoryFilesystem`](../test/memory-filesystem.md)
- Source: [`packages/core/src/runtime/filesystem.ts`](../../../packages/core/src/runtime/filesystem.ts)
