---
title: Bridge
description: Typed wire protocol between renderer, runtime, and host.
kind: reference
audience: app-developers
effect_version: 4
---

# Bridge

> Full references: [`reference/bridge/`](reference/bridge/). The host protocol, envelopes, streams, and redaction each have their own page.

The bridge carries typed messages between renderer, runtime, and host boundaries. It is a **protocol boundary, not an application abstraction**.

## Main exports

`@effect-desktop/bridge` exports:

- `HostProtocolEnvelope`, request, response, cancel, stream, and error envelope classes.
- `Client` and bridge client helpers.
- `RpcEndpoint`, `RpcCapability`, and `RpcSupport` metadata helpers.
- `makeBridgeCallRegistry` and `makeBridgeStreamRegistry` for observable bridge state.
- `RedactionFilter` and `redact` helpers for logs and inspector payloads.
- Effect RPC re-exports: `Rpc`, `RpcGroup`, `RpcClient`, `RpcServer`, `RpcMiddleware`, schemas.

## Verify Bridge Client Exports

```ts run
import { Client, HostProtocolEnvelope } from "../packages/bridge/src/index.js"

if (Client === undefined || HostProtocolEnvelope === undefined) {
  throw new Error("Client or HostProtocolEnvelope is unavailable")
}
```

## Failure model

Bridge failures are typed. Invalid arguments, unsupported methods, missing RPCs, invalid output, closed streams, and protocol state errors stay visible to callers and devtools.

## Streams

Bridge streams use explicit data, error, complete, and closed frames. Stream registries track lifecycle and backpressure metrics so long-running renderer subscriptions don't disappear.

## Where to go next

- [Bridge reference index](reference/bridge/)
- [Host protocol](reference/bridge/host-protocol.md)
- [Envelopes and framing](reference/bridge/envelopes-and-framing.md)
- [Streams and cancellation](reference/bridge/streams-and-cancellation.md)
- [Redaction](reference/bridge/redaction.md)
