# Bridge Stream State Belongs In Effect Primitives

## Context

Issue #1182 replaced bridge stream registry and active stream bookkeeping with
Effect-owned primitives.

## Learning

Manual observer sets are easy to make work for the happy path, but they make
leak behavior and replay semantics local policy. `SubscriptionRef` already owns
the state plus replayed changes, so the bridge registry should only define the
domain entry shape: stream id, terminal state, backpressure metrics, generation,
and cleanup grace.

Active stream ownership has the same shape. A bridge stream needs request and
resource identity, but producer lifetime is a fiber problem. `FiberMap` gives
the runtime a scoped owner for active producers; the bridge wrapper only adds
desktop protocol semantics such as closed terminal frames and cancellation by
request or resource id.

## Durable Rule

When a module keeps maps of running fibers or sets of observers, first ask
whether the map or set is only recreating an Effect primitive. Keep only the
domain policy around the primitive, and make identity reservation atomic before
running any producer.
