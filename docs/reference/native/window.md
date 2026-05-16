---
title: Window (native)
description: Native window lifecycle — create, close, restore.
kind: reference
audience: app-developers
effect_version: 4
---

# `Window`

Native window lifecycle. The runtime calls `Window.create` to open windows; the renderer calls through `useDesktop(WindowSupportedRpcs)` or the React adapter's `useCreateWindowMutation` / `useCloseWindowMutation`.

## Import

```ts
import {
  Window,
  WindowClient,
  WindowRpcs,
  WindowSupportedRpcs,
  WindowMethodNames,
  WindowSurface,
  WindowLive,
  WindowHandlersLive,
  makeWindowClientLayer,
  makeWindowServiceLayer,
  Native,
  type WindowClientApi,
  type WindowServiceApi,
  type WindowCreateOptions,
  type WindowHandle,
  type WindowPosition,
  type WindowSize,
  type WindowError
} from "@effect-desktop/native"
```

## Methods

| Method   | Payload               | Success        | Description              |
| -------- | --------------------- | -------------- | ------------------------ |
| `create` | `WindowCreateOptions` | `WindowHandle` | Open a native window.    |
| `close`  | `WindowHandle`        | `void`         | Destroy a native window. |

`WindowMethodNames = ["create", "close"]`. Additional methods (focus, hide, maximize) are reserved for future phases — `WindowSupportedRpcs` only contains what's currently callable.

## Errors

`WindowError = HostProtocolError` — invalid arg, not found, unsupported, internal.

## Layer composition

- `WindowLive` — service implementation (depends on `WindowClient`).
- `WindowHandlersLive` — runtime handler layer.
- `makeWindowClientLayer(client)` — substitute the client (tests).
- `makeWindowServiceLayer(client)` — service backed by a client.
- `Native.window` — app-composition layer for `Desktop.native(...)`.
- `WindowSurface.bridgeClientLayer(exchange, options)` — bridge client artifact used by adapters and tests.

## Surface

`WindowSurface = DesktopRpc.surface("Window", WindowRpcGroup, options)` — schema docs and contract laws.

## Mapped vs. supported

`Window` is a **mapped surface**: the public service `Window` wraps the supported client. `Window.create` accepts an optional `WindowCreateOptions` (the client requires one) and applies sensible defaults.

## Related

- How-to: [Add a window](../../how-to/add-a-window.md)
- Tutorial: [Add a second window](../../tutorials/02-add-a-second-window.md)
- Reference: [`WindowState`](../services/window-state.md), [React windows](../react/windows.md)
- Explanation: [RPC surface vs. mapped](../../explanation/rpc-surface-vs-mapped.md)
- Source: [`packages/native/src/window.ts`](../../../packages/native/src/window.ts)
