# Gate PTY Concurrency With Semaphores

## Context

Issue #1183 followed the PTY stream and exit-observer work by removing the manual PTY budget counter. The old code used a local `Ref<Map<string, number>>` plus explicit reserve and release helpers.

## What Changed

PTY budgets now use Effect `Semaphore` values keyed by owner scope through `RcMap`. Opening a PTY creates a PTY scope, acquires the owner-scope semaphore, and starts a scoped permit holder. The holder uses `withPermitsIfAvailable`, so full scopes fail immediately as `HostProtocolResourceBusyError` and successful holders release through Effect finalization when the PTY scope closes.

The PTY resource disposer no longer knows about budget counters. It only owns child disposal and PTY scope closure. That scope owns the child-exit observer and budget permit holder.

## What Worked

The process budget pattern transferred cleanly because the bounded lifetime is the same kind of lifetime: a returned handle keeps an OS-ish resource alive after the constructor call returns. The permit therefore belongs to the PTY scope, not to the `open()` effect itself.

## Friction

The fail-fast API still needs a non-blocking permit acquisition. `Semaphore.withPermitsIfAvailable` gives that behavior, but it releases when the wrapped effect completes. The holder effect intentionally waits forever and relies on scope interruption to release the permit at the PTY lifetime boundary.

## Durable Rule

When replacing manual counters with semaphores, verify the lifetime being bounded. If the budget is for a resource lifetime, the semaphore permit must be held by the resource scope, not by the constructor call that returns the resource handle.
