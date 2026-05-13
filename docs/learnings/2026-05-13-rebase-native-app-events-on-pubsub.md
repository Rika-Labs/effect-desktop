# Rebase Native App Events On Effect PubSub

Issue: #1222

## What changed

Native `AppEventRouter` no longer owns subscriber maps, per-subscriber `Queue`s, audit `Queue`
buffering, or manual queue interruption. Windows, focus, buffered first-responder events, and
pending per-window replay now live in a schema-coded `AppEventRouterState` backed by
`SubscriptionRef`.

Routed delivery uses per-window/per-event `PubSub` channels, and audit uses a replaying sliding
`PubSub`. Subscriptions now acquire the live `PubSub` subscription before draining pending events,
then emit pending replay followed by `Stream.fromSubscription(...)`. The router constructor is
scoped so audit and event channels shut down with the owning layer scope.

## What mattered

The non-obvious part was that replacing a local queue fanout with `PubSub` changes the exact handoff
point between replayed state and live delivery. If pending first-responder events are drained before
the live subscription is acquired, a live event published during replay can be lost. If buffered
events are both moved into pending state and published on window open, a subscriber can observe the
same event twice.

The fix was to make pending replay a state handoff, not a second publish path:

```ts
const subscription = yield* PubSub.subscribe(channel)
const pending = yield* takePendingEvents(windowId, event)

return Stream.fromIterable(pending).pipe(Stream.concat(Stream.fromSubscription(subscription)))
```

## Review changes

Review changed the implementation in five places:

- subscriptions acquire the live `PubSub` subscription before draining pending replay;
- `windowOpened` no longer republishes buffered first-responder events after moving them to pending
  state;
- the router adds a scoped finalizer for audit and event channels;
- tests now prove buffered, pending, and drained state transitions through `observeState()`;
- stale `subscriptionQueueCapacity` / `auditQueueCapacity` options became `eventChannelCapacity` and
  `auditReplayCapacity`.

## Architecture-debt sweep

Removed here: manual subscriber maps, per-subscriber queues, queue interruption, audit `Queue`
buffering, mutable `Map` state behind a plain `Ref`, and caller-declared subscription payload
generics that required assertions around untyped event payload storage.

Kept intentionally: `AppEventRouter`, because it owns durable desktop routing policy:
first-responder selection, target validation, pending replay, audit decisions, owner scopes, and
dispatch refusal short-circuiting. No follow-up issue was opened.

## Rule

When replacing manual replay-plus-live delivery with `PubSub`, subscribe to the live channel before
draining replay state, and test an event published during replay; otherwise a simpler Effect-native
implementation can still lose events at the handoff.
