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
  ProcessLayer,
  ProcessLive,
  type ProcessApi,
  type ProcessSpawnOptions,
  type ProcessExitStatus,
  type ProcessHandle,
  type ProcessSnapshot,
  type ProcessBudgetPolicy,
  type ProcessPermissionPolicy,
  makeProcess
} from "@orika/core"
```

## API

| Method    | Signature                                                           |
| --------- | ------------------------------------------------------------------- |
| `spawn`   | `(command, args?, options?) => Effect<ProcessHandle, ProcessError>` |
| `list`    | `() => Effect<readonly ProcessSnapshot[]>`                          |
| `observe` | `() => Stream<readonly ProcessSnapshot[]>`                          |

## `ProcessSpawnOptions`

```ts
{
  cwd?: string
  env?: Readonly<Record<string, string>>
  shell?: boolean
}
```

Shellless by default. No shell expansion. Pass arguments as an array. `shell: true` is rejected unless `ProcessPermissionPolicy.shell` is `true`.

Processes are registered under the `ResourceOwner` that built the `Process` service. `Desktop.runtime(...)` supplies an app owner, `Desktop.window(..., services)` supplies a window owner, and custom job layers can provide `ResourceOwner.job(...)`.

## `ProcessHandle`

```ts
{
  readonly resource: ManagedResourceHandle<"process", "running">
  readonly pid: number
  readonly stdin: Sink<void, unknown, never, ProcessError, never>
  readonly all: Stream<Uint8Array, ProcessError>
  readonly stdout: Stream<Uint8Array, ProcessError>
  readonly stderr: Stream<Uint8Array, ProcessError>
  readonly exit: Effect<ProcessExitStatus, ProcessError>
  readonly kill: (signal?: unknown) => Effect<void, ProcessError>
}
```

`stdout`, `stderr`, and `all` are bounded streams; producers that exceed the per-stream byte budget fail with `HostProtocolBackpressureOverflowError`. `stdin` is an Effect `Sink` — pipe a `Stream<Uint8Array>` into it (e.g. `Stream.fromIterable([bytes]).pipe(Stream.run(handle.stdin))`). `kill` accepts a signal name from the validated signal set (`SIGTERM` is used when omitted). The handle re-checks freshness against `ResourceRegistry` before sending the signal.

## `ProcessBudgetPolicy`

```ts
{
  maxConcurrent?: number          // default 16 (per owner scope)
  stdoutBufferBytes?: number      // default 1_048_576
  stderrBufferBytes?: number      // default 262_144
}
```

## `ProcessPermissionPolicy`

```ts
{
  spawn?: readonly string[]   // exact command allowlist
  shell?: boolean             // gate `shell: true` spawns
}
```

## Permissions

`process.spawn` capability with **exact-match** command. Allowing `git` does not allow `gh`. Shell metacharacters in the command string (`;`, `|`, `&`, `>`, `<`, backtick, newline, `$(`) are rejected before any host call. `shell: true` requires `permissions.shell === true`.

## Errors

Failures arrive as `HostProtocolError` on the operation that produced them — never thrown:

- `PermissionDenied` — spawn rejected by `process.spawn` or `process.shell` policy.
- `InvalidArgument` — bad payload, shell metacharacter, bad signal, non-`Uint8Array` stdin chunk.
- `FileNotFound` — host could not locate the command.
- `ResourceBusy` — per-owner-scope concurrency budget exceeded.
- `BackpressureOverflow` — `stdout`/`stderr`/`all` consumer fell behind the buffer budget.
- `StaleHandle` — `kill` called on a handle whose registry entry has been disposed.

Non-zero exit codes are not failures; they're carried in `ProcessExitStatus.code` (with `signal` when the OS reports one).

## Test layer

`MockProcess.layer(options)` from `@orika/test`.

## Related

- How-to: [Run a child process](../../how-to/run-a-child-process.md)
- Reference: [`PTY`](pty.md), [`Worker`](worker.md), [`Sidecar`](sidecar.md)
- Source: [`packages/core/src/runtime/process.ts`](../../../packages/core/src/runtime/process.ts)
