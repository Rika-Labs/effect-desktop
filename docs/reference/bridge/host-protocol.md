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
  WINDOW_EVENT_METHOD
} from "@orika/bridge"
```

## Constants

- `HOST_PROTOCOL_VERSION` — current protocol version. Bumped on breaking changes.
- `HOST_PING_METHOD = "host.ping"` — handshake liveness.
- `HOST_VERSION_METHOD = "host.version"` — handshake version exchange.
- `WINDOW_CREATE_METHOD = "Window.create"` — open a window.
- `WINDOW_DESTROY_METHOD = "Window.destroy"` — close a window.
- `WINDOW_EVENT_METHOD = "Window.Event"` — raw host window event stream.

## Handshake clients

```ts
import { makeHostHandshakeClient, makeHostWindowClient } from "@orika/bridge"
```

`makeHostHandshakeClient(exchange)` returns `{ version(), ping() }`.

`makeHostWindowClient(exchange, options)` returns the raw host Window client used by native adapters, including lifecycle, lookup, bounds/state/chrome methods, and `events()` for `Window.Event`.

## Why constants

Method names are values, not strings sprinkled through the codebase. A typo in a handler doesn't compile.

## Related

- Reference: [Envelopes and framing](envelopes-and-framing.md), [`Window`](../native/window.md)
- Source: [`packages/bridge/src/protocol.ts`](../../../packages/bridge/src/protocol.ts),
  [`handshake.ts`](../../../packages/bridge/src/handshake.ts),
  [`window.ts`](../../../packages/bridge/src/window.ts)
