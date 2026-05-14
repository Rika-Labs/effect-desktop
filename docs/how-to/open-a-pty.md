---
title: How to open a PTY
description: Spawn an interactive pseudo-terminal session with bounded output and typed signals.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to open a PTY

A PTY (pseudo-terminal) is what you want when you need an interactive shell or a process that expects a terminal — bash, zsh, ssh, vim. `PTY` runs them through a substitutable adapter with permission policy and scoped cleanup.

## 1. Declare permission

```ts
import { PermissionRegistry } from "@effect-desktop/core"

const permissions = yield* PermissionRegistry
yield* permissions.declare(
  { kind: "process.spawn", command: "/bin/zsh" },
  { effect: "allow", source: "terminal-feature" }
)
```

PTY uses the same `process.spawn` capability as `Process` — the command is checked the same way.

## 2. Open

```ts
import { Effect, Stream } from "effect"
import { PTY } from "@effect-desktop/core"

const program = Effect.gen(function* () {
  const pty = yield* PTY
  const session = yield* pty.open({
    shell: "/bin/zsh",
    args: [],
    cwd: process.env.HOME,
    env: process.env,
    size: { rows: 24, cols: 80 },
    ownerScope: "terminal-window"
  })

  // Stream output
  yield* session.output.pipe(
    Stream.runForEach((chunk) =>
      Effect.sync(() => process.stdout.write(chunk))
    )
  )
})
```

`session.output` is a bounded stream. Excess output drops oldest chunks rather than blocking the producer.

## 3. Write input

```ts
yield* session.write(new TextEncoder().encode("ls -la\n"))
```

## 4. Resize

When the user resizes the terminal UI:

```ts
yield* session.resize({ rows: 40, cols: 120 })
```

Resizes are signaled to the underlying process so applications like `vim` re-render.

## 5. Send signals

```ts
yield* session.signal("SIGINT")  // Ctrl+C
yield* session.signal("SIGTERM")
```

## 6. Cleanup

When `"terminal-window"` closes, the PTY is closed, the process is signaled, and the resource is unregistered. Explicit close:

```ts
yield* session.close
```

## Adapter substitution

`PTY` accepts a substitutable adapter. Production uses the native PTY backend (`crates/native-pty`). Tests use `MockPTY` from `@effect-desktop/test`, which records open/write/resize/signal/close calls and returns deterministic output.

## Related

- Reference: [`PTY`](../reference/services/pty.md)
- How-to: [Run a child process](run-a-child-process.md), [Write a test with layers](write-a-test-with-layers.md)
