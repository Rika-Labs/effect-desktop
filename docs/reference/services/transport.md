---
title: Transport
description: App-protocol framing helpers and substitutable runtime connections.
kind: reference
audience: app-developers
effect_version: 4
---

# `Transport`

Owns app-protocol framing helpers and substitutable runtime connections. The `Transport` service is built from `makeTransport()` and exposes framing as `Effect`-typed methods.

## Import

```ts
import {
  Transport,
  type TransportApi,
  type TransportConnection,
  type TransportError,
  TransportScheme,
  TransportConnectTarget,
  TransportFrameInput,
  TransportUnframeInput,
  TransportConnectInput,
  TransportInvalidArgumentError,
  TransportFrameTooLargeError,
  TransportFrameTruncatedError,
  TransportClosedError,
  TransportWriteError,
  TransportReadError,
  TransportCloseError,
  MAX_FRAME_BYTES,
  makeInMemoryTransportPair,
  encodeFrame,
  FrameDecoder
} from "@orika/core/runtime/transport"
```

## TransportApi

| Method          | Signature                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `frame`         | `(input: unknown) => Effect<Uint8Array, TransportError>`                                        |
| `unframe`       | `(input: unknown) => Effect<readonly Uint8Array[], TransportError>`                             |
| `unframeStream` | `(input: unknown) => Stream<Uint8Array, TransportError>`                                        |
| `connect`       | `(input: unknown) => Effect<TransportConnection, TransportError, Socket.Socket \| Scope.Scope>` |

Inputs are schema-decoded:

- `frame` accepts `TransportFrameInput`: `{ scheme: "length-prefixed" \| "json-rpc", payload: Uint8Array, maxFrameBytes? }`.
- `unframe` accepts `TransportUnframeInput`: `{ scheme, bytes: Uint8Array, maxFrameBytes? }`.
- `unframeStream` accepts `{ scheme, chunks: Stream<Uint8Array, TransportError>, maxFrameBytes?, frameQueueCapacity? }`.
- `connect` accepts `TransportConnectInput`: `{ target: "stdio", maxFrameBytes? }`.

The frame size limit defaults to `MAX_FRAME_BYTES` (4 MiB).

## `TransportConnection`

```ts
interface TransportConnection {
  readonly send: (payload: Uint8Array) => Effect<void, TransportError>
  readonly receive: Stream<Uint8Array, TransportError>
  readonly close: () => Effect<void, TransportError>
}
```

`Transport.connect` requires a `Socket.Socket` service in scope; pair it with `layerStdioSocket` (Node/Bun stdio, from `@orika/core/runtime/stdio-socket`) or `layerPostMessageSocket` (browser renderer, from `@orika/core/runtime/postmessage-socket`). `instrumentTransportConnection(conn, { inspector, target })` wraps a connection so transport `connect`, `backpressure`, and `disconnect` events flow to a `BridgeInspector`.

## Tests

`makeInMemoryTransportPair({ queueCapacity? })` returns two `TransportConnection`s wired back-to-back with bounded queues — useful for unit tests without a real socket.

## Errors

`TransportError` is a union of the tagged errors above. Notable cases:

- `InvalidArgument` — input failed schema decode (e.g. bad scheme, non-`Uint8Array` payload, malformed `Content-Length` header).
- `FrameTooLarge` — payload exceeded `maxFrameBytes`.
- `FrameTruncated` — incoming stream ended mid-header or mid-body (`stage: "length" | "header" | "body"`).
- `TransportClosed` — operation attempted after the connection was closed.
- `TransportWriteFailed` / `TransportReadFailed` / `TransportCloseFailed` — wrapped socket errors with the original cause attached.

## Related

- Reference: [`Bridge` envelopes](../bridge/envelopes-and-framing.md)
- Source: [`packages/core/src/runtime/transport.ts`](../../../packages/core/src/runtime/transport.ts), [`stdio-socket.ts`](../../../packages/core/src/runtime/stdio-socket.ts), [`postmessage-socket.ts`](../../../packages/core/src/runtime/postmessage-socket.ts)
