---
title: How to read and write files
description: Use Filesystem with declared roots and scoped handles.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to read and write files

`Filesystem` is the runtime filesystem service. It enforces root containment, uses the current `ResourceOwner` for scoped handles, and returns typed failures.

## 1. Declare the root

```ts
import { PermissionRegistry } from "@orika/core"

const permissions = yield * PermissionRegistry
yield *
  permissions.declare(
    { kind: "filesystem.read", roots: ["/Users/me/Documents"] },
    { effect: "allow", source: "app-init" }
  )
yield *
  permissions.declare(
    { kind: "filesystem.write", roots: ["/Users/me/Documents"] },
    { effect: "approval", source: "app-init" }
  )
```

Reads under `/Users/me/Documents` are allowed. Writes prompt the user the first time.

## 2. Read

```ts
import { Effect } from "effect"
import { Filesystem } from "@orika/core"

const program = Effect.gen(function* () {
  const fs = yield* Filesystem
  const bytes = yield* fs.read("/Users/me/Documents/notes.md")
  const text = new TextDecoder().decode(bytes)
})
```

Use `read` for bytes and decode when you need text.

## 3. Write

```ts
yield * fs.writeAtomic("/Users/me/Documents/draft.md", new TextEncoder().encode("# Hello"))
```

Writes are atomic via a temp file + rename. A partial write does not leave a half-written file behind.

## 4. Watch

```ts
import { Stream } from "effect"

const events = fs.watch("/Users/me/Documents")

yield * events.pipe(Stream.runForEach((event) => Effect.log(`${event.kind}: ${event.path}`)))
```

Watcher resources close when their scope closes.

## 5. Failure shapes

`Filesystem` operations fail with the `HostProtocolError` union:

- `HostProtocolPermissionDeniedError` — path not under a declared root, or recursive remove without `allowRecursiveRemove`.
- `HostProtocolSymlinkEscapesRootError` — requested path is inside a root but its target escapes it.
- `HostProtocolFileNotFoundError` — `ENOENT` / not found.
- `HostProtocolDiskFullError` — `ENOSPC` while writing.
- `HostProtocolInvalidArgumentError` — malformed path or other unmappable OS error.

All typed via tagged errors; none thrown.

## Related

- Reference: [`Filesystem`](../reference/services/filesystem.md), [`MemoryFilesystem`](../reference/test/memory-filesystem.md)
- Explanation: [Permissions model](../explanation/permissions-model.md)
- How-to: [Declare a permission](declare-a-permission.md), [Write a test with layers](write-a-test-with-layers.md)
