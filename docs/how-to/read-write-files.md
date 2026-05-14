---
title: How to read and write files
description: Use Filesystem with declared roots and scoped handles.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to read and write files

`Filesystem` is the runtime filesystem service. It enforces root containment, requires an owner scope on every operation, and returns typed failures.

## 1. Declare the root

```ts
import { PermissionRegistry } from "@effect-desktop/core"

const permissions = yield* PermissionRegistry
yield* permissions.declare(
  { kind: "filesystem.read", roots: ["/Users/me/Documents"] },
  { effect: "allow", source: "app-init" }
)
yield* permissions.declare(
  { kind: "filesystem.write", roots: ["/Users/me/Documents"] },
  { effect: "approval", source: "app-init" }
)
```

Reads under `/Users/me/Documents` are allowed. Writes prompt the user the first time.

## 2. Read

```ts
import { Effect } from "effect"
import { Filesystem } from "@effect-desktop/core"

const program = Effect.gen(function* () {
  const fs = yield* Filesystem
  const text = yield* fs.readFileString({
    path: "/Users/me/Documents/notes.md",
    ownerScope: "window-main"
  })
})
```

For binary, `readFileBytes`. For listings, `readDirectory`.

## 3. Write

```ts
yield* fs.writeFileString({
  path: "/Users/me/Documents/draft.md",
  content: "# Hello",
  ownerScope: "window-main"
})
```

Writes are atomic via a temp file + rename. A partial write does not leave a half-written file behind.

## 4. Watch

```ts
import { Stream } from "effect"

const watcher = yield* fs.watch({
  path: "/Users/me/Documents",
  ownerScope: "window-main"
})

yield* watcher.events.pipe(
  Stream.runForEach((event) => Effect.log(`${event.kind}: ${event.path}`))
)
```

Watcher resources close when their scope closes.

## 5. Failure shapes

- `FilesystemPermissionDenied` — path not under a declared root.
- `FilesystemInvalidArgument` — malformed path, traversal attempt.
- `FilesystemSystemError` — OS-level error (ENOENT, EACCES, etc.).

All typed; none thrown.

## Related

- Reference: [`Filesystem`](../reference/services/filesystem.md), [`MemoryFilesystem`](../reference/test/memory-filesystem.md)
- Explanation: [Permissions model](../explanation/permissions-model.md)
- How-to: [Declare a permission](declare-a-permission.md), [Write a test with layers](write-a-test-with-layers.md)
