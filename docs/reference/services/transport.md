---
title: Transport
description: App-protocol framing helpers and substitutable runtime connections.
kind: reference
audience: app-developers
effect_version: 4
---

# `Transport`

Owns app-protocol framing helpers and substitutable runtime connections.

## Import

```ts
import {
  Transport,
  type TransportApi,
  TransportError,
  frame,
  unframe,
  unframeStream,
  makeInMemoryTransportPair
} from "@orika/core"
```

## Framing helpers

- `frame(payload)` → length-prefixed `Uint8Array` (big-endian).
- `unframe(buffer)` → payload or `TransportError`.
- `unframeStream(stream)` → `Stream` of payloads.

Supports the existing big-endian length-prefixed framing **plus** LSP-style JSON-RPC `Content-Length` frames.

## Connections

| Method    | Signature                                              |
| --------- | ------------------------------------------------------ |
| `connect` | `({ target: "stdio" }) => Effect<TransportConnection>` |

`TransportConnection`:

```ts
{
  send: (data: Uint8Array) => Effect<void>
  receive: Stream<Uint8Array>
  close: Effect<void>
}
```

## Tests

`makeInMemoryTransportPair()` returns a pair of Effect-native connections without reaching into raw host transport internals.

## Errors

`TransportError` covers invalid inputs, oversized frames, truncated frames, closed transports, and write failures.

## Related

- Reference: [`Bridge` envelopes](../bridge/envelopes-and-framing.md)
- Source: [`packages/core/src/runtime/transport.ts`](../../../packages/core/src/runtime/transport.ts) (if present), bridge helpers in `packages/bridge/src/`
