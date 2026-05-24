---
title: How to open a PTY
description: Spawn an interactive pseudo-terminal session with bounded output and typed signals.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to open a PTY

A PTY (pseudo-terminal) is what you want when you need an interactive shell or a process that expects a terminal — bash, zsh, ssh, vim. `PTY` runs them through a substitutable adapter with permission policy and scoped cleanup.

## 1. Configure permission policy

```ts
import { PtyLayer, type PtyAdapter } from "@orika/core"

declare const ptyAdapter: PtyAdapter

const TerminalPtyLive = PtyLayer({
  adapter: ptyAdapter,
  permissions: {
    spawn: ["/bin/zsh"]
  }
})
```

PTY uses a `pty.spawn` policy with exact command matching. Allowing `/bin/zsh` does not allow `zsh`, `/bin/bash`, or any shell-shaped command string.

## 2. Open

```ts
import { Effect, Stream } from "effect"
import { PTY } from "@orika/core"

const program = Effect.gen(function* () {
  const pty = yield* PTY
  const session = yield* pty.open({
    argv: ["/bin/zsh"],
    cwd: process.env.HOME,
    env: process.env,
    rows: 24,
    cols: 80
  })

  // Stream output
  yield* session.output.pipe(
    Stream.runForEach((chunk) => Effect.sync(() => process.stdout.write(chunk)))
  )

  const status = yield* session.onExit
  return status.code
})
```

Run this program with a layer that provides `PTY`, such as `TerminalPtyLive` above.

`session.output` is a bounded stream. Excess output drops oldest chunks rather than blocking the producer.

## 3. Write input

```ts
yield * session.write(new TextEncoder().encode("ls -la\n"))
```

## 4. Resize

When the user resizes the terminal UI:

```ts
yield * session.resize({ rows: 40, cols: 120 })
```

Resizes are signaled to the underlying process so applications like `vim` re-render.

## 5. Send signals

```ts
yield * session.kill("SIGINT") // Ctrl+C
yield * session.kill("SIGTERM")
```

## 6. Cleanup

When the owning `ResourceOwner` scope closes, the PTY is closed, the process is signaled, and the resource is unregistered. Explicit close:

```ts
yield * session.kill()
```

## Adapter substitution

`PTY` accepts a substitutable adapter. Production uses the native PTY backend (`crates/native-pty`). Tests use `MockPTY` from `@orika/test`, which records open, write, resize, kill, and cleanup calls while returning deterministic output.

## Related

- Reference: [`PTY`](../reference/services/pty.md)
- How-to: [Run a child process](run-a-child-process.md), [Write a test with layers](write-a-test-with-layers.md)
