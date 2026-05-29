---
title: Host protocol
description: The wire format and method constants spoken between runtime and host.
kind: reference
audience: app-developers
effect_version: 4
---

# Host protocol

The framed message protocol the runtime uses to talk to the Rust host (and to the renderer through the bridge). This is a wire-level reference; application code typically never constructs envelopes by hand.

## Import

```ts
import {
  HOST_PROTOCOL_VERSION,
  HOST_PING_METHOD,
  HOST_VERSION_METHOD,
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD,
  WINDOW_EVENT_METHOD,
  RENDERER_DISCONNECTED_EVENT,
  RENDERER_RESUME_METHOD,
  RENDERER_RESUMED_EVENT,
  RENDERER_RESUME_DENIED_EVENT
} from "@orika/bridge"
```

## Constants

- `HOST_PROTOCOL_VERSION = "2.0.0"` — current protocol version. Bumped on breaking changes.
- `HOST_PING_METHOD = "host.ping"` — handshake liveness.
- `HOST_VERSION_METHOD = "host.version"` — handshake version exchange.
- `WINDOW_CREATE_METHOD = "Window.create"`, `WINDOW_DESTROY_METHOD = "Window.destroy"`, `WINDOW_EVENT_METHOD = "Window.Event"` — window lifecycle and the host window event stream.
- The full `Window.*`, `Dock.*`, `Menu.*`, `WebView.*`, `Pty.*`, `SafeStorage.*`, `SessionProfile.*`, `CookieStore.*`, `BrowsingData.*`, `SessionPermission.*`, `Download.*`, `NetworkAuth.*`, `WebRequest.*`, and `NativeNetwork.*` method names are exported as `*_METHOD` constants from `@orika/bridge`. See `packages/bridge/src/protocol.ts` for the canonical list.
- Renderer reconnect events: `RENDERER_DISCONNECTED_EVENT`, `RENDERER_RESUME_METHOD`, `RENDERER_RESUMED_EVENT`, `RENDERER_RESUME_DENIED_EVENT`. `DEFAULT_RECONNECT_WINDOW_MS` and `DEFAULT_MAX_BACKFILL_EVENTS` set the resume defaults.

## Handshake clients

```ts
import { makeHostHandshakeClient, makeHostWindowClient, negotiateHostVersion } from "@orika/bridge"
```

`makeHostHandshakeClient(exchange, options?)` returns `{ ping(): Effect<void, HostProtocolError>; version(): Effect<HostVersionPayload, HostProtocolError> }`. `options` lets you inject `nextRequestId`, `nextTraceId`, and `now`.

`negotiateHostVersion(client, expected?)` calls `client.version()` and fails with a `HostProtocolInvalidStateError` if the host's `protocolVersion` does not match `expected` (defaults to `HOST_PROTOCOL_VERSION`).

`makeHostWindowClient(exchange, options?)` returns the raw host `Window` client used by native adapters. It covers `create`, `show`/`hide`/`focus`, lookup (`getCurrent`, `getById`, `list`, `getParent`, `getChildren`), bounds/state/chrome methods, attention/progress/decorations, fullscreen, vibrancy, and `subscribeEvents` for `Window.Event`.

## Why constants

Method names are values, not strings sprinkled through the codebase. A typo in a handler doesn't compile.

## Related

- Reference: [Envelopes and framing](envelopes-and-framing.md), [`Window`](../native/window.md)
- Source: [`packages/bridge/src/protocol.ts`](../../../packages/bridge/src/protocol.ts),
  [`handshake.ts`](../../../packages/bridge/src/handshake.ts),
  [`window.ts`](../../../packages/bridge/src/window.ts)
