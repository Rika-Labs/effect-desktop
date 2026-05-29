# Deferred findings from the second source-grounded bug sweep (2026-05-29)

Three medium/low findings were verified against source but deliberately not fixed in
the sweep because each needs a design decision or a change to shared infrastructure
that is disproportionate to the finding's severity. Captured here with the fix shape.

## 1. Bridge inspector drops event history for late subscribers

`packages/bridge/src/inspector.ts` builds its PubSub with `replay: 0`, so any
subscriber that attaches after the first event — or that reconnects — silently
misses every frame emitted before it subscribed. The functionally identical
collector in `packages/core/src/runtime/inspector-events.ts` uses
`PubSub.sliding({ capacity: 1024, replay: 128 })` for the same observe-the-system
purpose.

No in-repo consumer subscribes to `BridgeInspector.events` (transport.ts and
client.ts only `emit`); it exists for external devtools. Whether buffered replay
is wanted is a product call, which is why it was not changed blindly.

Fix shape: match the collector — `replay: 128` (or expose `replay` on
`BridgeInspectorOptions` with that default). Add `inspector.test.ts` asserting a
late subscriber receives the most recent `min(N, replay)` events.

## 2. command-binding dedup is a TOCTOU race

`bindScopedCommand` (`packages/native/src/command-binding.ts`) checks
`resources.get(id)` then later calls `resources.register(...)` with no mutual
exclusion across the two. Two concurrent binds of the same id both see
`Option.none()`, both run the native `register`, and `ResourceRegistry.register`
(`packages/core/src/runtime/resources.ts`) allocates a fresh uuid for the second
rather than returning the existing handle — leaving a duplicate native
registration plus a leaked second binding scope/fiber.

Fix shape (deep): move dedup into `ResourceRegistry.register` so a duplicate
requested id returns the existing `ManagedResourceHandle` instead of allocating a
new uuid. This removes the racy guard entirely and keeps the invariant in the one
owner of resource state. It touches shared infrastructure used by every native
surface, so it warrants its own change + concurrency test
(`Effect.all([...], { concurrency: "unbounded" })` binding the same id twice,
asserting one registry entry and one native register call).

## 3. command-binding leaves a zombie "registered" entry when the event stream dies

After a successful bind, if the underlying events stream fails with `RegisterE`,
the forked `Stream.runForEach` fiber dies but the binding scope is not closed, so
`options.release` never runs and the registry still reports the resource as
`registered` while events no longer reach `invoke`.

Partial fix shipped: the stream failure is now logged via `Effect.tapError`
instead of being swallowed silently (honours the no-swallowed-errors rule).

Remaining decision: the registry state still diverges from reality. The correct
behaviour (tear the binding down so `release` runs and the registry reflects the
dead binding, vs. retry/reconnect the stream) is a policy choice that should be
made deliberately, then implemented with a test that drives a failing event
stream and asserts the chosen outcome.
