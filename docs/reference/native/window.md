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
import { Desktop } from "@effect-desktop/core"
import {
  Window,
  WindowRpcs,
  WindowSupportedRpcs,
  WindowMethodNames,
  Native,
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

App code selects the capability through the native composition layer:

```ts
Desktop.make({
  id: "com.acme.windows",
  windows: Desktop.window("main", { title: "Windows" }),
  native: Desktop.native(Native.window),
  permissions: Native.permissions(...Native.Permissions.window.all)
})
```

- `Native.window` — app-composition layer for `Desktop.native(...)`.
- `Native.Permissions.window.*` — authority data derived from the same surface metadata.
- `WindowLive` and `WindowHandlersLive` — runtime layers behind `Native.window`.
- `WindowSurface.bridgeClientLayer(exchange, options)` — bridge adapter artifact used by renderer adapters and tests.
- `makeWindowClientLayer(client)` and `makeWindowServiceLayer(client)` — deterministic test seams, not app-composition API.

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
