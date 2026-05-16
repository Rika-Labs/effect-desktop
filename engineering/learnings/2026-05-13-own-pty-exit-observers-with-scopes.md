# Own PTY Exit Observers With Scopes

## Context

Issue #1298 followed the PTY output stream cleanup. Once output no longer had a local producer fiber, the remaining unowned PTY lifecycle fiber was the child-exit observer created with `Effect.runFork`.

## What Changed

Each PTY open now creates a `Scope`. The child-exit observer is forked with `forkScoped` in that scope, and registry cleanup closes the scope after child disposal. A small `PtyDisposalOrigin` state prevents observer-initiated cleanup from interrupting itself through the registry disposer.

## What Worked

The process lifecycle pattern transferred cleanly: claim observer disposal before calling `resource.dispose`, and have registry disposal return early when the observer already owns cleanup. That keeps natural child exit and explicit scope close from racing through the same shutdown path.

## Friction

The public `makePty` constructor is not scoped, so the scope has to be per-child rather than service-wide. That is still the right lifetime: the observer belongs to one child process, not to the PTY service as a whole.

## Durable Rule

Any background observer for a registry-owned resource needs an owned `Scope` plus an explicit disposal-origin state when the observer can initiate registry cleanup itself.
