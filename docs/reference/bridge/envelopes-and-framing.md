---
title: Envelopes and framing
description: Request, response, stream, cancel envelopes plus length-prefixed framing.
kind: reference
audience: app-developers
effect_version: 4
---

# Envelopes and framing

Bridge messages are typed envelopes wrapped in length-prefixed frames.

## Import

```ts
import {
  HostProtocolEnvelope,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  HostProtocolCancelByRequestEnvelope,
  HostProtocolError,
  HostProtocolInvalidArgumentError,
  HostProtocolInvalidOutputError,
  HostProtocolNotFoundError,
  HostProtocolUnsupportedError,
  hostProtocolErrorRecoverableDefault,
  decodeHostProtocolEnvelope,
  encodeHostProtocolEnvelope,
  makeHostProtocolInvalidStateError,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolNotFoundError
} from "@orika/bridge"
```

## Envelope variants

- **Request** — `{ kind: "request", id, method, payload, traceId }`.
- **Response** — `{ kind: "response", id, success?, error? }`.
- **Stream** — `{ kind: "stream", requestId, frame: data | error | complete }`.
- **Cancel** — `{ kind: "cancel", requestId }`.

`HostProtocolEnvelope` is the union.

## Framing

The envelope JSON is wrapped in a frame. Two framings supported:

- **Big-endian length prefix** — 4 bytes of length then the JSON. Default for stdio.
- **LSP `Content-Length`** — header-style framing for tools that expect JSON-RPC.

See [`Transport`](../services/transport.md) for `frame`, `unframe`, `unframeStream`.

## Errors

- `HostProtocolInvalidArgumentError` — payload didn't decode against the schema.
- `HostProtocolInvalidOutputError` — runtime returned something the schema doesn't accept.
- `HostProtocolNotFoundError` — method has no registered handler.
- `HostProtocolUnsupportedError` — operation isn't supported on this platform.

All carry `recoverable: boolean`. `hostProtocolErrorRecoverableDefault` is the default predicate.

## Encoding helpers

- `encodeHostProtocolEnvelope(envelope)` — to JSON.
- `decodeHostProtocolEnvelope(json)` — to typed envelope.
- `makeHostProtocol<X>Error(...)` — error constructors.

## Related

- Reference: [Host protocol](host-protocol.md), [Streams and cancellation](streams-and-cancellation.md), [`Transport`](../services/transport.md)
- Source: [`packages/bridge/src/host-protocol.ts`](../../../packages/bridge/src/host-protocol.ts)
