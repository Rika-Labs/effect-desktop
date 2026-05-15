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
import { MemoryFilesystem, type FilesystemOptions } from "@effect-desktop/test"
```

## Layer

```ts
import { Layer } from "effect"
import { ResourceOwner } from "@effect-desktop/core"

const FilesystemLive = MemoryFilesystem.layer({
  rootScope: "/",
  policy: defaultMemoryPolicy
}).pipe(Layer.provide(ResourceOwner.test("test")))
```

## Behavior

- Reads, writes, atomic replace, stats, removal.
- Watchers fire deterministically.
- Symlinks supported.
- Permission checks identical to production `Filesystem`.

## Why match the production contract

So tests fail the same way production fails. A path traversal that returns `FilesystemPermissionDenied` in production also returns it in `MemoryFilesystem`.

## Related

- Reference: [`Filesystem`](../services/filesystem.md)
- How-to: [Write a test with layers](../../how-to/write-a-test-with-layers.md)
- Source: [`packages/test/src/memory-filesystem.ts`](../../../packages/test/src/memory-filesystem.ts)
