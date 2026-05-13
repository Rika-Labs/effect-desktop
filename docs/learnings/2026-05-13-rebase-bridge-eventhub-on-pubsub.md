# Rebase Bridge EventHub On Effect PubSub

Issue: #1274

## What changed

Bridge `EventHub` no longer owns per-subscriber `Queue`s, subscriber `Set`s, manual fanout, or
manual finalizer cleanup. Each bridge event channel now owns one Effect `PubSub`, and subscriptions
are ordinary `Stream.fromPubSub(...)` streams.

The bridge boundary still owns the durable protocol work: event method routing, Schema payload
encoding, host event envelope construction, timestamp and trace-id validation, and translation from
bridge backpressure metadata to Effect `PubSub` constructors.

## What mattered

The non-obvious part was that replacing a local queue fanout with canonical `PubSub` is not purely
mechanical. The old implementation created one queue per subscriber, so one slow subscriber could
drop or block independently. A single channel `PubSub` makes backpressure channel-level: a slow
subscriber can cause `dropNewest` or `block` behavior to affect every publisher on that event.

That shared behavior is the right Effect-native model for this boundary, but it had to be made
explicit in tests:

```ts
const slow = hub.exchange.subscribe("Project.events.changed").pipe(
  Stream.take(3),
  Stream.tap(() => Effect.sleep("50 millis")),
  Stream.runDrain
)

const fast = hub.exchange.subscribe("Project.events.changed").pipe(Stream.take(3), Stream.runDrain)
```

## Review changes

Review changed the implementation in three places:

- unchecked raw event specs now fail as typed `InvalidArgument` values during `EventHub` setup;
- event `overflow: "error"` is rejected because events have no durable overflow-error frame;
- tests now cover fast and slow subscribers together for `dropNewest`, `dropOldest`, and `block`.

## Architecture-debt sweep

Removed here: custom event subscriber sets, custom per-subscriber queues, manual publish fanout, and
the `offerEvent` wrapper over `Queue.offer`.

Kept intentionally: `EventHub`, because it owns bridge protocol semantics rather than mirroring an
Effect primitive. No new follow-up was opened; the nearby native app event router is already tracked
by #1222, and bridge stream cleanup remains tracked separately by #1287.

## Rule

When replacing local queue fanout with `PubSub`, test the shared backpressure semantics directly;
otherwise the code may be simpler while the event delivery contract changes invisibly.
