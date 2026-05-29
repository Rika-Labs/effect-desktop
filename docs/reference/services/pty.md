---
title: PTY
description: Pseudo-terminal sessions with resize, signals, and substitutable adapter.
kind: reference
audience: app-developers
effect_version: 4
---

# `PTY`

Owns pseudo-terminal sessions, resize and kill operations, output streams, permission policy, budget policy, and cleanup.

## Import

```ts
import {
  PTY,
  PtyLayer,
  type PtyApi,
  type PtyError,
  type PtyHandle,
  type PtyOpenOptions,
  type PtyOpenInput,
  type PtyChild,
  type PtyExitStatus,
  type PtyOutputMetrics,
  type PtyAdapter,
  type PtyBudgetPolicy,
  type PtyPermissionPolicy,
  makePty
} from "@orika/core"
```

## API

| Method | Signature                                                  |
| ------ | ---------------------------------------------------------- |
| `open` | `(options: PtyOpenOptions) => Effect<PtyHandle, PtyError>` |

## `PtyOpenOptions`

```ts
{
  argv: readonly [string, ...string[]]
  rows: number
  cols: number
  cwd?: string
  env?: Readonly<Record<string, string>>
}
```

`argv[0]` is the command checked against `pty.spawn`; `argv[1..]` are arguments. `rows`/`cols` must be positive integers.

PTY sessions are registered under the `ResourceOwner` that built the `PTY` service. `Desktop.runtime(...)` supplies an app owner, `Desktop.window(..., services)` supplies a window owner, and custom job layers can provide `ResourceOwner.job(...)`.

## `PtyHandle`

```ts
{
  readonly resource: ManagedResourceHandle<"pty", "running">
  readonly pid: Option<number>
  readonly output: Stream<Uint8Array>
  readonly outputMetrics: Effect<PtyOutputMetrics>
  readonly onExit: Effect<PtyExitStatus>
  readonly write: (chunk: unknown) => Effect<void>
  readonly resize: (size: { rows, cols }) => Effect<void>
  readonly kill: (signal?: unknown) => Effect<void>
}
```

`kill(signal?)` sends the requested signal after validating it (`PtySignalInput` accepts either a control-character-free string or a positive integer). Use `onExit` to await the process status. Owner-scope cleanup terminates the PTY via `terminateTree`, escalating to `forceKillTree` after `gracefulShutdownMs`. `outputMetrics` exposes input/output frame counts, dropped bytes, queue depth, and coalescing factor for devtools.

## `PtyBudgetPolicy`

```ts
{
  maxConcurrent?: number          // default 16 per owner scope
  outputBufferBytes?: number      // default 262_144
  outputCoalesceBytes?: number    // default 65_536
  outputCoalesceMs?: number       // default 4
  outputOverflow?: "block" | "dropNewest" | "dropOldest" | "error"  // default "dropOldest"
}
```

Output frames larger than `outputBufferBytes` are dropped (or fail when `outputOverflow` is `"error"`). Adjacent frames are coalesced within the `outputCoalesceMs` / `outputCoalesceBytes` window to reduce per-frame overhead.

## Adapter

`PTY` accepts a substitutable `PtyAdapter`. The adapter opens a lower-level `PtyChild`; applications should depend on `PtyHandle`, not the adapter child.

`@orika/native` exports `NativePtyLayer({ exchange, permissions, ... })`, which adapts host `Pty.*` methods to the core `PTY` service. The Rust host owns native PTY processes through `crates/native-pty`; the TypeScript layer owns permission checks, budgets, output buffering, and scoped cleanup.

Tests use `MockPTY`.

## Permissions

`PtyLayer({ permissions })` enforces a `pty.spawn` policy with exact command matching:

```ts
PtyLayer({
  adapter,
  permissions: {
    spawn: ["/bin/zsh"]
  }
})
```

Denied opens fail with `HostProtocolPermissionDeniedError` and capability `pty.spawn`.

## Test layer

`MockPTY.layer(options)` from `@orika/test`.

## Related

- How-to: [Open a PTY](../../how-to/open-a-pty.md)
- Reference: [`Process`](process.md)
- Source: [`packages/core/src/runtime/pty.ts`](../../../packages/core/src/runtime/pty.ts)
