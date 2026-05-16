---
date: 2026-05-13
type: refactor
topic: Own worker exit observers with scopes
issue: https://github.com/Rika-Labs/effect-desktop/issues/1299
pr: direct-to-main
---

# Own Worker Exit Observers With Scopes

## Decision

Worker lifecycle observers should be owned by the same scope as the runtime they observe, and
observer-driven cleanup needs an explicit origin guard so it does not interrupt itself.

## What Changed

The plan was to remove the last detached `Effect.runFork` in `Worker.spawn`. The shipped shape
creates a per-worker `Scope`, forks `observeWorkerExit` with `Effect.forkScoped`, and uses a
`WorkerDisposalOrigin` ref to distinguish registry cleanup from worker self-exit cleanup.

```mermaid
flowchart LR
  Spawn["Worker.spawn"] --> Scope["worker Scope"]
  Scope --> Runtime["WorkerRuntime"]
  Scope --> Observer["forkScoped exit observer"]
  Observer --> Dispose["resource.dispose"]
  Dispose --> Origin["disposal origin"]
  Origin --> Cleanup["remove snapshot + release budget"]
  Cleanup --> Close["Scope.close"]
```

## Why It Mattered

The non-obvious part is that `resource.dispose()` is still the right single cleanup entrypoint for
self-exit, because it preserves budget release and registry removal. The observer just needs to
claim ownership first so the disposer can skip runtime shutdown and let the observer close the scope
after disposal returns.

## Example

```ts
const origin = yield * claimWorkerObserverDisposal(disposalOrigin)
if (origin !== "registry") {
  yield * resource.dispose()
  yield * Scope.close(workerScope, Exit.void)
}
```

## Rule Candidate

None. The current AGENTS.md hard rules already require scoped ownership for lifecycle work and
architecture-debt sweep notes before closing a ticket.
