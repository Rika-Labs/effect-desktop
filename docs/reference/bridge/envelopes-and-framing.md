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
  HostProtocolEventEnvelope,
  HostProtocolStreamByRequestEnvelope,
  HostProtocolStreamByResourceEnvelope,
  HostProtocolCancelByRequestEnvelope,
  HostProtocolCancelByResourceEnvelope,
  HostProtocolError,
  HostProtocolInvalidArgumentError,
  HostProtocolInvalidOutputError,
  HostProtocolNotFoundError,
  HostProtocolUnsupportedError,
  HostProtocolMethodNotFoundError,
  hostProtocolErrorRecoverableDefault,
  decodeHostProtocolEnvelope,
  encodeHostProtocolEnvelope,
  encodeHostProtocolFrame,
  decodeHostProtocolFrame,
  parseHostProtocolFrameJson,
  decodeHostProtocolFrameJson,
  makeHostProtocolInvalidStateError,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolNotFoundError
} from "@orika/bridge"
```

## Envelope variants

Every envelope carries `timestamp: number` (host clock, non-negative integer) and `traceId: string` (non-empty, no ASCII control characters).

- **Request** — `{ kind: "request", id, method, timestamp, traceId, windowId?, originToken?, payload? }`.
- **Response** — `{ kind: "response", id, timestamp, traceId, payload? | error? }` (mutually exclusive — never both).
- **Event** — `{ kind: "event", method, timestamp, traceId, windowId?, payload? }`.
- **Stream by request** — `{ kind: "stream", id, timestamp, traceId, payload? | error? }`.
- **Stream by resource** — same shape with `resourceId` instead of `id`.
- **Cancel by request / by resource** — `{ kind: "cancel", id|resourceId, timestamp, traceId }`.

Stream and cancel envelopes must carry exactly one of `id` or `resourceId`. Stream envelopes must not carry both `payload` and `error`. `decodeHostProtocolEnvelope` rejects envelopes that violate these invariants.

`HostProtocolEnvelope` is the union schema.

## Framing

Two framing schemes are supported (see `TransportScheme` in [`Transport`](../services/transport.md)):

- `length-prefixed` — 4-byte big-endian unsigned length prefix, then the UTF-8 JSON payload. Default for stdio and `makeFramedSocketConnection`.
- `json-rpc` — LSP-style `Content-Length: <bytes>\r\n\r\n<payload>` framing.

Per-call frame size is bounded by `MAX_FRAME_BYTES` (4 MiB) unless a smaller `maxFrameBytes` is supplied. Oversized or truncated frames raise `TransportFrameTooLargeError` / `TransportFrameTruncatedError`.

## Runtime stdio

`layerStdioSocket` reserves stdout for length-prefixed host protocol frames. It redirects Effect logging and `console.log`/`info`/`debug`/`table`/`dir`/`dirxml` to stderr (via `LogToStderr` and a one-time replacement on `globalThis.console`) so only explicit protocol writes hit stdout.

## Errors

`HostProtocolError` is a union of 40 `Schema.Class` errors (see `HOST_PROTOCOL_ERROR_SPECS` in `protocol.ts` for the full list). Each carries `tag`, `message`, `operation`, optional `platform`/`code`/`cause`/`remediation`/`docsUrl`, plus tag-specific payload fields, and `recoverable: boolean`. The union schema enforces that `recoverable` equals `hostProtocolErrorRecoverableDefault(tag)`. Common tags include:

- `InvalidArgument` — payload failed schema validation (`field`, `reason`).
- `InvalidOutput` — handler return value failed schema validation (`method`, `reason`).
- `MethodNotFound` — no registered handler for `method`.
- `Unsupported` — operation isn't supported on this platform (`reason`).
- `Cancelled` — fiber was interrupted (`source: string`; the framework only emits `"renderer"`, `"runtime"`, or `"host"`).

`hostProtocolErrorRecoverableDefault(tag)` returns the policy-defined recoverable flag.

## Encoding helpers

- `encodeHostProtocolEnvelope(envelope)` — encode to the JSON shape.
- `decodeHostProtocolEnvelope(input)` — decode and validate cross-field invariants.
- `encodeHostProtocolFrame(envelope, operation)` — encode to UTF-8 JSON bytes inside an `Effect`.
- `decodeHostProtocolFrame(bytes, operation)` / `parseHostProtocolFrameJson` / `decodeHostProtocolFrameJson` — symmetric decoders.
- `makeHostProtocol<X>Error(...)` — error constructors that auto-fill `recoverable` from the policy table.

## Related

- Reference: [Host protocol](host-protocol.md), [Streams and cancellation](streams-and-cancellation.md), [`Transport`](../services/transport.md)
- Source: [`packages/bridge/src/protocol.ts`](../../../packages/bridge/src/protocol.ts),
  [`codec.ts`](../../../packages/bridge/src/codec.ts)
