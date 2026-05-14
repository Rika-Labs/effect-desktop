---
title: PTY
description: Pseudo-terminal sessions with resize, signals, and substitutable adapter.
kind: reference
audience: app-developers
effect_version: 4
---

# `PTY`

Owns pseudo-terminal sessions, resize/signal operations, output streams, permission policy, budget policy, and cleanup.

## Import

```ts
import {
  PTY,
  type PtyApi,
  type PtyOpenInput,
  type PtyChild,
  type PtyExitStatus,
  type PtyAdapter,
  type PtyBudgetPolicy,
  type PtyPermissionPolicy,
  makePty
} from "@effect-desktop/core"
```

## API

| Method | Signature                                   |
| ------ | ------------------------------------------- |
| `open` | `(input: PtyOpenInput) => Effect<PtyChild>` |
| `list` | `() => Effect<PtySnapshot[]>`               |

## `PtyOpenInput`

```ts
{
  shell: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  size?: { rows: number, cols: number }
  ownerScope: string
}
```

## `PtyChild`

```ts
{
  readonly id: string
  readonly output: Stream<Uint8Array>
  readonly write: (data: Uint8Array) => Effect<void>
  readonly resize: (size: { rows, cols }) => Effect<void>
  readonly signal: (signal: string) => Effect<void>
  readonly close: Effect<void>
  readonly exit: Effect<PtyExitStatus>
}
```

## Adapter

`PTY` accepts a substitutable `PtyAdapter`. Production uses `crates/native-pty`. Tests use `MockPTY`.

## Permissions

Uses the same `process.spawn` capability as `Process`.

## Test layer

`MockPTY.layer(options)` from `@effect-desktop/test`.

## Related

- How-to: [Open a PTY](../../how-to/open-a-pty.md)
- Reference: [`Process`](process.md)
- Source: [`packages/core/src/runtime/pty.ts`](../../../packages/core/src/runtime/pty.ts)
