---
date: 2026-05-13
type: refactor
topic: Enforce worker budgets with semaphores
issue: https://github.com/Rika-Labs/effect-desktop/issues/1172
pr: direct-to-main
---

# Enforce Worker Budgets With Semaphores

## Decision

Worker budget permits should be held by the worker scope, not manually counted beside it.

## What Changed

The plan was to replace `Ref<Map<string, number>>` worker counters with an Effect concurrency
primitive. The shipped shape follows the already-proven Process and PTY pattern: an
`RcMap<ownerScope, Semaphore>` stores one semaphore per owner scope, and each worker creates a
scoped permit holder that lives until the worker scope closes.

## Why It Mattered

Manual counters made every cleanup path responsible for both resource disposal and budget release.
After #1299, Worker already had a per-worker scope, so the simpler invariant is: if the worker is
alive, the scope holds a permit; if the scope is closed, the permit is gone.

## Example

```ts
const holder = semaphore.withPermitsIfAvailable(1)(
  Deferred.succeed(acquired, true).pipe(Effect.andThen(Effect.never))
)

yield * holder.pipe(Effect.forkScoped({ startImmediately: true }), Scope.provide(workerScope))
```

## Rule Candidate

None. The current hard rules already require using Effect primitives for concurrency and removing
local wrappers when they only reimplement Effect behavior.
