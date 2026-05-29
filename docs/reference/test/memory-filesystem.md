---
title: MemoryFilesystem
description: In-memory tree with full permission enforcement matching the production Filesystem.
kind: reference
audience: app-developers
effect_version: 4
---

# `MemoryFilesystem`

In-memory implementation of the `Filesystem` service. Same contract — root containment, permissions, atomic writes, watchers — without touching real disks.

## Import

```ts
import { MemoryFilesystem, MemoryFilesystemLive, type MemoryFilesystemOptions } from "@orika/test"
```

`MemoryFilesystemLive` is an alias for `MemoryFilesystem.layer`.

## Layer

```ts
import { Layer } from "effect"
import { ResourceOwner, ResourceRegistryLive } from "@orika/core"

const FilesystemLive = MemoryFilesystem.layer({
  directories: ["/workspace"],
  files: [{ path: "/workspace/seed.txt", bytes: new TextEncoder().encode("seed") }],
  permissions: {
    readRoots: ["/workspace"],
    writeRoots: ["/workspace"]
  }
}).pipe(Layer.provide(ResourceRegistryLive), Layer.provide(ResourceOwner.test("test")))
```

## Options

```ts
{
  files?: readonly { path: string; bytes: Uint8Array }[]
  directories?: readonly string[]
  symlinks?: readonly { path: string; target: string }[]
  permissions?: FilesystemPermissionPolicy
  now?: () => number  // defaults to Effect Clock
}
```

## Behavior

- Reads, writes, atomic replace, stats, removal.
- Watchers fire deterministically and dispose their registry entry on close.
- Symlinks supported, with the production root-containment policy (escape returns `SymlinkEscapesRoot`).
- Permission checks identical to production `Filesystem`.
- Default file timestamps come from the Effect `Clock` so `TestClock` makes them deterministic.

## Why match the production contract

So tests fail the same way production fails. A path traversal that returns `FilesystemPermissionDenied` in production also returns it in `MemoryFilesystem`.

## Related

- Reference: [`Filesystem`](../services/filesystem.md)
- How-to: [Write a test with layers](../../how-to/write-a-test-with-layers.md)
- Source: [`packages/test/src/index.ts`](../../../packages/test/src/index.ts)
