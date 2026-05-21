---
title: Filesystem
description: Permissioned filesystem with declared roots and scoped handles.
kind: reference
audience: app-developers
effect_version: 4
---

# Filesystem

> Full reference: [`reference/services/filesystem.md`](reference/services/filesystem.md). How-to: [`read and write files`](how-to/read-write-files.md).

The `Filesystem` service owns runtime filesystem access behind permission policy, root containment, typed failures, and testable adapters.

## Public surface

`@orika/core` exports `Filesystem`, filesystem options, permission policy types, and constructors such as `makeFilesystem`.

## Security model

Writable roots are explicit. Paths are normalized and checked before writes, copies, deletes, or symlink-sensitive operations. Reads need `filesystem.read` for a containing root; writes need `filesystem.write`.

## Verify Filesystem Test Surface

```ts run
import { Filesystem } from "../packages/core/src/index.js"
import { MemoryFilesystem } from "../packages/test/src/index.js"

if (Filesystem === undefined || MemoryFilesystem === undefined) {
  throw new Error("Filesystem or MemoryFilesystem is unavailable")
}
```

## Testing

`MemoryFilesystem.layer(options)` from `@orika/test` for deterministic files, directories, symlinks, reads, writes, deletes, and denied-path assertions.

## Where to go next

- [How-to: read and write files](how-to/read-write-files.md)
- [`Filesystem` reference](reference/services/filesystem.md)
- [`MemoryFilesystem` reference](reference/test/memory-filesystem.md)
- [How-to: declare a permission](how-to/declare-a-permission.md)
