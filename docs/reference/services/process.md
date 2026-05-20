---
title: Process
description: Shellless process spawning with permission policy and bounded output.
kind: reference
audience: app-developers
effect_version: 4
---

# `Process`

Runtime primitive for spawned child processes. Validates inputs, enforces a permission policy, registers each child as a scoped resource, bounds stdout/stderr streams, terminates the process tree on cleanup.

## Import

```ts
import {
  Process,
  type ProcessApi,
  type ProcessSpawnInput,
  type ProcessExitStatus,
  type ProcessHandle,
  type ProcessBudgetPolicy,
  type ProcessPermissionPolicy,
  makeProcess
} from "@orika/core"
```

## API

| Method    | Signature                                             |
| --------- | ----------------------------------------------------- |
| `spawn`   | `(command, args?, options?) => Effect<ProcessHandle>` |
| `list`    | `() => Effect<ProcessSnapshot[]>`                     |
| `observe` | `() => Stream<readonly ProcessSnapshot[]>`            |

## `ProcessSpawnOptions`

```ts
{
  cwd?: string
  env?: Record<string, string>
  shell?: boolean
}
```

Shellless. No shell expansion. Pass arguments as an array.

Processes are registered under the `ResourceOwner` that built the `Process` service. `Desktop.runtime(...)` supplies an app owner, `Desktop.window(..., services)` supplies a window owner, and custom job layers can provide `ResourceOwner.job(...)`.

## `ProcessHandle`

```ts
{
  readonly pid: number
  readonly stdout: Stream<Uint8Array>
  readonly stderr: Stream<Uint8Array>
  readonly stdin: { write, close }
  readonly exit: Effect<ProcessExitStatus>
  readonly kill: (signal?: string) => Effect<void>
}
```

Streams are bounded — older chunks drop if the consumer falls behind.

## Permissions

`process.spawn` capability with **exact-match** command. Allowing `git` does not allow `gh`.

## Errors

Failures arrive as `HostProtocolError` on the operation that produced them. Non-zero exit codes are not failures; they're carried in `ProcessExitStatus.code`.

## Test layer

`MockProcess.layer(options)` from `@orika/test`.

## Related

- How-to: [Run a child process](../../how-to/run-a-child-process.md)
- Reference: [`PTY`](pty.md), [`Worker`](worker.md), [`Sidecar`](sidecar.md)
- Source: [`packages/core/src/runtime/process.ts`](../../../packages/core/src/runtime/process.ts)
