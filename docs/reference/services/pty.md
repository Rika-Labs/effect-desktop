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
  type PtyApi,
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
  argv: [string, ...string[]]
  rows: number
  cols: number
  cwd?: string
  env?: Record<string, string>
}
```

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

`kill(signal?)` sends the requested signal after validating it. Use `onExit` to await the process status. Owner-scope cleanup also terminates the PTY if the caller does not kill it explicitly.

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
