# Enforce Process Budgets With Semaphores

## Context

Issue #1171 followed the scoped process-exit work by removing the manual process budget counter. The old code used a local `Ref<Map<string, number>>` plus explicit reserve and release helpers.

## What Changed

Process budgets now use Effect `Semaphore` values keyed by owner scope through `RcMap`. Spawning a process creates a process scope, acquires the owner-scope semaphore, and starts a scoped permit holder. The holder uses `withPermitsIfAvailable`, so full scopes fail immediately as `HostProtocolResourceBusyError` and successful holders release through Effect finalization when the process scope closes.

The process resource disposer no longer knows about budget counters. It only closes the process scope. That scope owns the child process, exit observer, and budget permit holder.

## What Worked

The important design point was that a process permit must live as long as the child process, not merely as long as the `spawn()` call. A plain `semaphore.withPermit(spawn(...))` would release too early when `spawn()` returns a handle. Binding the permit holder to the process scope preserves the existing public behavior while moving the lifecycle to Effect primitives.

## Friction

Effect's `Semaphore.withPermitsIfAvailable` is the right non-blocking primitive for the current fail-fast API, but it scopes release to the effect it wraps. To make that effect represent process lifetime, the wrapped effect waits forever and is interrupted by the process scope. That is more explicit than a hidden counter, but it requires naming the holder as part of process lifecycle.

## Durable Rule

When replacing manual counters with semaphores, verify the lifetime being bounded. If the budget is for a resource lifetime, the semaphore permit must be held by the resource scope, not by the constructor call that returns the resource handle.
