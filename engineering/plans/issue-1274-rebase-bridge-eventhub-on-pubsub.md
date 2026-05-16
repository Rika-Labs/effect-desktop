# Issue #1274: Rebase Bridge EventHub On Effect PubSub

## Problem

`packages/bridge/src/events.ts` owns an in-memory event fanout runtime with a custom
`Map<string, EventChannel>`, a `Set` of per-subscriber queues, manual subscription cleanup, and
manual publish iteration. Effect already provides this exact fanout and backpressure primitive
through `PubSub` and `Stream.fromPubSub`.

The bridge should keep only durable bridge semantics: event names, schema encoding, host protocol
envelopes, timestamp and trace validation, and translation from bridge backpressure metadata to an
Effect primitive.

## Target Shape

Each bridge event channel stores its `BridgeEventSpec` and an Effect `PubSub` selected from the
event backpressure policy:

```ts
type EventChannel = {
  readonly spec: BridgeEventSpec
  readonly pubsub: PubSub.PubSub<HostProtocolEventEnvelope>
}

subscribe(method) = Stream.fromPubSub(channel.pubsub)
publish(...) = PubSub.publish(channel.pubsub, envelope).pipe(Effect.asVoid)
```

`dropOldest` maps to `PubSub.sliding`, `dropNewest` maps to `PubSub.dropping`, and `block` maps to
`PubSub.bounded`. Event queue sizes must be positive because Effect `PubSub` does not support
zero-capacity channels. Event `overflow: "error"` is rejected because bridge events have no durable
overflow-error frame semantics.

## Implementation Plan

1. Replace `Queue` imports and per-subscriber `Set<EventQueue>` state in `events.ts` with
   `PubSub`.
2. Make `EventHub(...)` allocate event channel PubSubs through `Effect.gen` instead of a synchronous
   `Effect.sync` block.
3. Implement `makeEventPubSub(spec)` as the only bridge-to-Effect backpressure translation point.
4. Replace `subscribe(...)` with `Stream.fromPubSub(channel.pubsub)` and keep the existing unknown
   method failure.
5. Replace manual `Effect.forEach(channel.queues, ...)` publishing with `PubSub.publish(...)`.
6. Tighten event backpressure validation so generated event channels cannot request zero capacity.
7. Reject `overflow: "error"` for event specs while leaving it available to bridge streams.
8. Extend tests to prove multi-subscriber fanout, drop-oldest/drop-newest behavior, unknown event
   failures, and validation for zero-sized or error-overflow event backpressure.

## Architecture-Debt Sweep

Remove now:

- Manual event subscriber sets.
- Manual per-subscriber queues.
- Manual publish fanout and subscriber cleanup.

Keep:

- `EventHub`, because it owns bridge protocol semantics and translates contract metadata to event
  envelopes.
- Bridge event specs, because they are schema-backed protocol metadata, not a parallel Effect
  stream DSL.

While touching bridge event code, sweep for nearby wrappers that only mirror `PubSub`, `Stream`, or
`Queue`. If a wrapper is not carrying host protocol semantics, remove it here. If it is larger than
this issue, open a follow-up with before/after and track it in the roadmap.

## Verification

- Focused tests:
  - `bun test packages/bridge/src/events.test.ts packages/bridge/src/contracts.test.ts`
- Sweep:
  - `rg "Set<.*Queue|EventQueue|Queue\\." packages/bridge/src/events.ts`
  - `rg "unknown as|as unknown" packages/bridge/src/events.ts packages/bridge/src/events.test.ts`
- API:
  - `bun packages/cli/src/bin.ts check --api --write`
  - `bun packages/cli/src/bin.ts check --api`
- Full before push:
  - `bun run typecheck`
  - `bun run lint`
  - `bun run lint:types`
  - `bun run format:check`
  - `bun run check`
  - `bun run build`
  - `bun test`
  - `cargo fmt --check`
  - `cargo check --workspace`
  - `cargo test --workspace`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `git diff --check`
