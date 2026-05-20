---
title: Worker
description: Background TypeScript workers with typed channels and capability checks.
kind: reference
audience: app-developers
effect_version: 4
---

# `Worker`

Runtime primitive for background TypeScript in a separate worker runtime. The framework spawns a Bun worker through a substitutable adapter, validates every channel message through Effect Schema, and registers each worker as a scope-bound `ResourceRegistry` handle.

## Import

```ts
import {
  Worker,
  type WorkerApi,
  type WorkerHandle,
  type WorkerSpawnInput,
  type WorkerSpawnOptions,
  type WorkerAdapter,
  type WorkerOptions,
  type WorkerBudgetPolicy,
  WorkerCrashedError,
  WorkerChannelError,
  WorkerCapabilityNotHeldError,
  WorkerInvalidArgumentError,
  WorkerResourceBusyError,
  WorkerStaleHandleError,
  WorkerUnsupportedError,
  type WorkerError,
  makeWorker
} from "@orika/core"
```

## API

| Method  | Signature                                                         |
| ------- | ----------------------------------------------------------------- |
| `spawn` | `(input: WorkerSpawnOptions<I, O>) => Effect<WorkerHandle<I, O>>` |
| `list`  | `() => Effect<WorkerSnapshot[]>`                                  |

## `WorkerSpawnOptions<I, O>`

```ts
{
  script: string
  inputSchema: Schema.Schema<I>
  outputSchema: Schema.Schema<O>
  context?: { resource?: string, traceId?: string }
  capabilities?: NormalizedCapability[]
}
```

Workers are registered under the `ResourceOwner` that built the `Worker` service. `Desktop.runtime(...)` supplies an app owner, `Desktop.window(..., services)` supplies a window owner, and custom job layers can provide `ResourceOwner.job(...)`.

## `WorkerHandle<I, O>`

```ts
{
  id: string
  send: (message: I) => Effect<void, WorkerChannelError>
  messages: Stream<O>
  close: Effect<void>
}
```

## Pre-spawn checks

- Every declared capability must have a matching `PermissionRegistry` declaration. Missing → `WorkerCapabilityNotHeldError`.
- The `inputSchema` is enforced on every `send`. Bad shape → `WorkerChannelError`.
- The `outputSchema` is enforced on every received message.

## Errors (closed union)

`WorkerError = WorkerCrashedError | WorkerChannelError | WorkerCapabilityNotHeldError | WorkerInvalidArgumentError | WorkerResourceBusyError | WorkerStaleHandleError | WorkerUnsupportedError`.

## Cleanup

Closing the owning scope shuts down the worker and releases the per-scope concurrency budget.

## Long-running cancelable work

Workers cover typed background work that needs its own resource handle, message channel, capability preflight, and concurrency budget. They do not provide OS-enforced filesystem, network, CPU, or memory isolation; use the native `ExecutionSandbox` surface once platform adapters exist for that security boundary. For TypeScript-only background work that needs cancellation but not its own permission scope, use `Effect.fork` inside a handler — the surrounding scope handles cancellation. A separate runtime-managed `Job` primitive with retry policies and replayable progress is on the roadmap; until then, build the same shape from `Stream`, `Schedule`, and `Scope` directly per Effect's primitives.

## Related

- How-to: [Spawn a worker](../../how-to/spawn-a-worker.md)
- Reference: [`Process`](process.md), [`PTY`](pty.md), [`PermissionRegistry`](permission-registry.md)
- Source: [`packages/core/src/runtime/worker.ts`](../../../packages/core/src/runtime/worker.ts)
