# Own Process Exit Fibers With Scopes

## Context

Issue #1159 removed the last detached process exit observer from `Process`. The old code used `Effect.runFork(...)`, which made child-exit observation a top-level runtime fiber rather than a fiber owned by the process resource lifetime.

## What Changed

`Process.spawn` now creates a process scope for the Effect child process and forks the exit observer into that same scope with `Effect.forkScoped({ startImmediately: true })`. The handle creation is effectful so observer startup participates in the same `Effect` workflow as child spawning, registry registration, and snapshot creation.

External resource disposal now claims the registry side of disposal before it kills the child and closes the process scope. Natural child exit claims the observer side, updates snapshots, completes the exit deferred, disposes the resource, and closes the process scope. The disposal-origin state prevents a child exit caused by registry cleanup from recursively calling `resource.dispose()` while `ResourceRegistry.closeScope(...)` is already waiting on that same cleanup.

## What Worked

The smallest useful abstraction was not a new process lifecycle manager. The durable boundary stayed `Process`, because it owns desktop policy: permissions, owner scopes, process budgets, bounded output, snapshots, and host-protocol errors. Effect owns the fiber and child-process mechanics.

The regression test needed to model a child that accepts `SIGTERM` but never reports exit. That proved the observer is interrupted by scope close instead of being left as detached work.

## Friction

Forking into a scope is not enough if the scoped fiber can re-enter the registry path that is closing that same scope. The first scoped version deadlocked because `closeScope` took the resource, ran cleanup, cleanup killed the child, the observer observed exit, and the observer called `resource.dispose()` while the registry was already disposing that id.

## Durable Rule

When a scoped background fiber also removes its owning resource on natural completion, distinguish natural completion from owner-driven disposal. Owner-driven disposal should close the scope; the scoped fiber should not recursively dispose the same registry handle while that close is in flight.
