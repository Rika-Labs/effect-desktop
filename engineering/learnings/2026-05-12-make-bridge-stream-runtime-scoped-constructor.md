---
date: 2026-05-12
type: in-flight-refactor
topic: Make bridge stream runtime an Effect-scoped constructor
issue: https://github.com/Rika-Labs/effect-desktop/issues/1287
pr: none
---

# Make Bridge Stream Runtime an Effect-Scoped Constructor

## Decision

When replacing an unsafe synchronous runtime constructor with scoped Effect acquisition, preserve any required internal finalizer ordering with an owned child scope instead of relying on the caller's scope strategy.

## What changed

The plan was to move bridge stream runtime construction from `Streams(...)` / `Streams.withOptions(...)` to `Streams.scoped(...)` / `Streams.scopedWithOptions(...)`, allocating `FiberMap`, `SubscriptionRef`, and the default stream registry through Effect. That shipped, but review found that simply registering runtime disposal and `FiberMap` finalization on the caller's scope made terminal state depend on whether the caller used a sequential or parallel scope.

The final shape keeps construction Effect-scoped while giving the stream runtime its own sequential child scope for active producer fibers. `runtime.dispose()` and caller scope finalization both close through `disposeActiveStreams`, and stream startup/cancel/dispose are serialized with a lifecycle semaphore.

## Why it mattered

Bridge streams have a protocol invariant that raw fiber interruption alone cannot provide: cancellation and disposal must emit or record a `closed` terminal state before producer interruption can become an `error` terminal. Effect owns resource acquisition and interruption, but Effect Desktop still owns the bridge-specific terminal-frame ordering.

## Example

```ts
const active = yield * Effect.acquireRelease(makeActiveBridgeStreams(), disposeActiveStreams)

const reservation =
  yield *
  active.lifecycle.withPermit(
    Effect.gen(function* () {
      const reservation = yield* openActiveStream(active, stream)
      if (reservation._tag !== "Reserved") {
        return reservation
      }
      yield* FiberMap.run(active.fibers, streamId, producer)
      return reservation
    })
  )
```

## Rule candidate

When an Effect-scoped refactor has bridge-specific shutdown semantics, use owned child scopes or explicit synchronization to preserve protocol ordering; why: caller scope finalizer strategy is not a stable place to encode protocol invariants.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it -- `/learn` never auto-edits AGENTS.md.
