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

`@orika/bridge` exports:

- `HostProtocolEnvelope` schema and the request, response, event, stream, and cancel envelope classes (request- and resource-keyed variants).
- The full `HostProtocolError` union and per-tag `Schema.Class` errors (e.g. `HostProtocolPermissionDeniedError`, `HostProtocolCancelledError`).
- `Client` and the contract-style bridge client (`BridgeClient`, `BridgeClientExchange`).
- `makeDesktopClientProtocol` / `makeDesktopServerProtocol` — Effect `RpcClient.Protocol` / `RpcServer.Protocol` factories that ride a `DesktopTransportSend & DesktopTransportRun`.
- `makeDesktopRpcHandlerRuntime` — dispatches host requests through `RpcServer` with cancel, terminal-state, and origin-auth bookkeeping.
- `RpcEndpoint`, `RpcCapability`, `RpcSupport` annotation helpers and the `rpcEndpointKind` / `rpcCapability` / `rpcSupport` readers.
- `makeBridgeCallRegistry` and `makeBridgeStreamRegistry` for observable bridge state.
- `makeBridgeInspector`, `BridgeInspectorEvent`, and the boundary/direction literals for transport, frame, and decode-failure observability.
- `RedactionFilter`, `redact`, `redactWithEvidence`, `redactForJson`, and `Redacted`-backed secret helpers.
- Effect RPC re-exports: `Rpc`, `RpcGroup`, `RpcClient`, `RpcClientError`, `RpcMessage`, `RpcMiddleware`, `RpcSchema`, `RpcSerialization`, `RpcServer`.

## Verify bridge exports

```ts run
import {
  Client,
  HostProtocolEnvelope,
  makeDesktopRpcHandlerRuntime
} from "../packages/bridge/src/index.js"

if (
  Client === undefined ||
  HostProtocolEnvelope === undefined ||
  makeDesktopRpcHandlerRuntime === undefined
) {
  throw new Error("Bridge exports are unavailable")
}
```

## Failure model

Bridge failures are typed. Every `HostProtocolError` carries `message`, `operation`, `recoverable`, optional `platform`/`code`/`remediation`/`docsUrl`, and a tag-specific payload (e.g. `FileNotFound.path`, `StaleHandle.expectedGeneration`). The `HostProtocolError` schema enforces that `recoverable` matches `hostProtocolErrorRecoverableDefault(tag)`. Invalid arguments, unsupported methods, missing RPCs, invalid output, closed streams, and protocol state errors stay visible to callers and devtools.

## Streams

Bridge streams use explicit `data`, `error`, `complete`, and `closed` frames (`BridgeStreamFrame`). The renderer client treats `error`, `complete`, and `closed` as terminal and starts a best-effort `HostProtocolCancelByRequestEnvelope` when the consumer unsubscribes before the stream terminates. `BridgeStreamRegistry` records open and terminal entries and surfaces a snapshot/observe pair; backpressure metrics are reported by the producer via `updateBackpressure`.

## Where to go next

- [Bridge reference index](reference/bridge/)
- [Host protocol](reference/bridge/host-protocol.md)
- [Envelopes and framing](reference/bridge/envelopes-and-framing.md)
- [Streams and cancellation](reference/bridge/streams-and-cancellation.md)
- [Redaction](reference/bridge/redaction.md)
