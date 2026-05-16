---
title: Streams and cancellation
description: How streaming RPC and cancel envelopes work end-to-end.
kind: reference
audience: app-developers
effect_version: 4
---

# Streams and cancellation

Streaming RPC methods return `Stream<A, E, R>` instead of `Effect<A, E, R>`. The bridge ferries items as `HostProtocolStreamByRequestEnvelope` frames; cancellation flows back as `HostProtocolCancelByRequestEnvelope`.

## Frame kinds

A stream envelope carries one of three frame kinds:

- `data` — `{ kind: "data", value: A }`
- `error` — `{ kind: "error", error: E }` (terminal)
- `complete` — `{ kind: "complete" }` (terminal)

The bridge stops emitting after `error` or `complete`.

## Cancellation flow

1. Renderer unmounts a `useDesktopStream` subscription (or unmounts the component).
2. The bridge sends `HostProtocolCancelByRequestEnvelope { requestId }`.
3. The runtime cancels the Effect fiber driving the stream.
4. The fiber's scope closes; finalizers run; resources unregister.
5. The renderer sees the subscription torn down.

End-to-end. You did not write any of the above.

## Stream registries

`makeBridgeStreamRegistry()` returns a `BridgeStreamRegistry` that tracks open streams for backpressure metrics and devtools observation. The runtime uses one per session.

## Backpressure

Each stream has a bounded buffer. When the consumer falls behind, the framework either drops oldest items (default for telemetry-style streams) or pauses upstream emission (default for application streams). Configured per-call via the `capacity` option on `useDesktopStream`.

## Related

- Reference: [Envelopes and framing](envelopes-and-framing.md), [React streams](../react/streams.md)
- Tutorial: [Stream from the runtime](../../tutorials/03-stream-from-the-runtime.md)
- Source: [`packages/bridge/src/streams.ts`](../../../packages/bridge/src/streams.ts)
