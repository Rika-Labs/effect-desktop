---
title: How to run a child process
description: Spawn a shellless process with typed permission policy and bounded output.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to run a child process

`Process` is the runtime primitive for spawned child processes. It validates inputs, enforces a permission policy, registers each child as a scoped resource, bounds stdout/stderr streams, and terminates the process tree on cleanup.

## 1. Declare what's allowed to run

```ts
import { PermissionRegistry } from "@orika/core"

const permissions = yield * PermissionRegistry
yield *
  permissions.declare(
    { kind: "process.spawn", command: "git" },
    { effect: "allow", source: "app-init" }
  )
```

`process.spawn` capabilities use **exact match** on the command. Allowing `git` does not allow `gh` or `git-secret`.

## 2. Spawn

```ts
import { Effect, Stream } from "effect"
import { Process } from "@orika/core"

const program = Effect.gen(function* () {
  const proc = yield* Process
  const handle = yield* proc.spawn("git", ["status", "--porcelain"], {
    cwd: "/path/to/repo"
  })

  // Collect stdout
  const stdout = yield* handle.stdout.pipe(
    Stream.runFold("", (acc, chunk) => acc + new TextDecoder().decode(chunk))
  )

  // Wait for exit
  const status = yield* handle.exit
  if (status.code !== 0) {
    return yield* Effect.fail(new Error(`git failed: ${status.code}`))
  }

  return stdout
})
```

`Process.spawn` is **shellless** by default. There is no shell expansion. Pass arguments as an array. If you need a shell, opt in with `shell: true` or use `Command` for app-level command logic.

The spawned process is owned by the `ResourceOwner` that built the `Process` service. App runtime services use the app owner; window service layers use the window owner.

## 3. Stream output

`handle.stdout` and `handle.stderr` are bounded `Stream`s. They drop oldest chunks when the consumer falls behind, so a runaway process doesn't OOM the runtime.

```ts
yield *
  handle.stdout.pipe(Stream.runForEach((chunk) => Effect.log(new TextDecoder().decode(chunk))))
```

## 4. Send input

```ts
yield * handle.stdin.write(new TextEncoder().encode("hello\n"))
yield * handle.stdin.close()
```

## 5. Kill explicitly (optional)

The framework kills the process tree when the owner scope closes. If you want to terminate sooner:

```ts
yield * handle.kill // sends SIGTERM
yield * handle.kill("SIGKILL")
```

## 6. Inspect what's running

```ts
const snapshots = yield * proc.list()
// [{ pid, command, args, ownerScope, childPids, state, lastExit }, ...]
```

Devtools' processes panel renders this live.

## Failure shapes

All process failures are typed `HostProtocolError` values on the operation that produced them — never thrown exceptions:

- Spawn rejected by permissions → `PermissionDenied`.
- Invalid arguments (path, command shape) → `InvalidArgument`.
- Process killed by the framework on cleanup → audit event with reason.
- Exit non-zero → returned through `handle.exit` as a `ProcessExitStatus`, not a failure.

## Related

- Reference: [`Process`](../reference/services/process.md), [`Command`](../reference/services/command.md), [`PermissionRegistry`](../reference/services/permission-registry.md)
- How-to: [Open a PTY](open-a-pty.md), [Spawn a worker](spawn-a-worker.md)
- Explanation: [Resource lifecycle](../explanation/resource-lifecycle.md)
