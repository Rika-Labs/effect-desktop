---
title: Streams and cancellation
description: How streaming RPC and cancel envelopes work end-to-end.
kind: reference
audience: app-developers
effect_version: 4
---

# Streams and cancellation

Streaming RPC methods return `Stream<A, E, R>` instead of `Effect<A, E, R>`. The bridge ferries items inside `HostProtocolStreamByRequestEnvelope` frames; cancellation flows back as `HostProtocolCancelByRequestEnvelope` (or `HostProtocolCancelByResourceEnvelope` for resource-keyed streams).

## Frame kinds

A stream envelope's `payload` decodes to one of four `BridgeStreamFrame` variants:

- `{ type: "data", chunk }` — one item.
- `{ type: "error", error }` — terminal.
- `{ type: "complete" }` — terminal.
- `{ type: "closed" }` — terminal (stream torn down without explicit success or failure).

Alternatively, the envelope itself carries `error: HostProtocolError`, which is also terminal. The renderer client stops decoding after the first terminal frame or error.

## Cancellation flow

1. Renderer unmounts a stream subscription (or the renderer Effect fiber is interrupted).
2. The bridge client forks a best-effort `HostProtocolCancelByRequestEnvelope` (bounded by a short dispatch grace) and interrupts the request fiber.
3. The runtime cancels the Effect fiber driving the stream via `BridgeHandlerRuntime.cancel`.
4. The fiber's scope closes; finalizers run; resources unregister.
5. The renderer sees the subscription torn down with a `HostProtocolCancelledError` (`source: "renderer"`).

End-to-end. You did not write any of the above.

## Stream registries

`makeBridgeStreamRegistry(cleanupGraceMs?)` returns a `BridgeStreamRegistry` that tracks open and terminal stream entries plus optional backpressure metrics. The API:

- `register(streamId)` — record an open entry (bumps generation on re-register).
- `terminate(streamId, terminal, now)` — mark `complete`, `error`, or `closed`.
- `isTerminal(streamId)`, `snapshot()`, `observe()`.
- `updateBackpressure(streamId, metrics)` — record `{ evictedFrames, overflow, queueCapacity, queueDepth }`.
- `gcExpired(now)` — drop terminal entries older than `cleanupGraceMs` (default 30 000 ms).

## Backpressure

Per-stream backpressure policy lives on the contract — `BridgeMethodSpec.backpressure` or `BridgeStreamSpec.backpressure` carries `{ strategy: "buffer" | "drop" | "block", size?, overflow?: "error" | "dropOldest" | "dropNewest" | "block" }`. Producers report runtime metrics via `BridgeStreamRegistry.updateBackpressure`; the registry exposes them through `snapshot()`/`observe()` for devtools.

## Related

- Reference: [Envelopes and framing](envelopes-and-framing.md), [React streams](../react/streams.md)
- Tutorial: [Stream from the runtime](../../tutorials/03-stream-from-the-runtime.md)
- Source: [`packages/bridge/src/streams.ts`](../../../packages/bridge/src/streams.ts), [`client.ts`](../../../packages/bridge/src/client.ts)
