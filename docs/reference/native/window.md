---
title: Window (native)
description: Native window lifecycle and state controls.
kind: reference
audience: app-developers
effect_version: 4
---

# `Window`

Native window lifecycle and state controls. The runtime calls `Window.create` to open windows; the renderer calls through `useDesktop(WindowSupportedRpcs)` or the React adapter's window mutations.

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

| Method           | Payload                  | Success        | Description                                       |
| ---------------- | ------------------------ | -------------- | ------------------------------------------------- |
| `create`         | `WindowCreateOptions`    | `WindowHandle` | Open a native window.                             |
| `show`           | `WindowHandle`           | `void`         | Make an existing window show.                     |
| `hide`           | `WindowHandle`           | `void`         | Hide an existing window.                          |
| `focus`          | `WindowHandle`           | `void`         | Request focus for a window.                       |
| `getBounds`      | `WindowHandle`           | `WindowBounds` | Read logical window bounds.                       |
| `setBounds`      | `WindowBoundsInput`      | `void`         | Move and resize a window.                         |
| `center`         | `WindowHandle`           | `void`         | Center in the current display.                    |
| `setTitle`       | `WindowTitleInput`       | `void`         | Set the window title.                             |
| `setResizable`   | `WindowResizableInput`   | `void`         | Enable or disable user resizing.                  |
| `setDecorations` | `WindowDecorationsInput` | `void`         | Enable or disable native window decorations.      |
| `minimize`       | `WindowHandle`           | `void`         | Minimize a window.                                |
| `maximize`       | `WindowHandle`           | `void`         | Maximize a window.                                |
| `restore`        | `WindowHandle`           | `void`         | Clear minimized, maximized, and fullscreen state. |
| `setFullscreen`  | `WindowFullscreenInput`  | `void`         | Enter or exit borderless fullscreen.              |
| `getState`       | `WindowHandle`           | `WindowState`  | Read minimized, maximized, and fullscreen state.  |
| `close`          | `WindowHandle`           | `void`         | Destroy a native window.                          |

`WindowMethodNames = ["create", "close", "show", "hide", "focus", "getBounds", "setBounds", "center", "setTitle", "setResizable", "setDecorations", "minimize", "maximize", "restore", "setFullscreen", "getState"]`. Bounds use logical coordinates; the host converts through the display scale factor before applying Tao position and size operations. Mutable title, resizable, and decorations controls are portable Tao operations. Mutable titlebar style, vibrancy, shadows, transparency, traffic lights, blur, simple fullscreen, a separate close-vs-destroy host lifecycle, and host-backed state change events remain reserved for later phases.

## Errors

`WindowError = HostProtocolError` — invalid arg, not found, unsupported, internal.

## Layer composition

App code selects the capability through the native composition layer:

```ts
Desktop.make({
  id: "com.acme.windows",
  windows: Desktop.window("main", { title: "Windows" }),
  native: Desktop.native(Native.Window),
  permissions: Desktop.permissions(...Native.Permissions.window.all.map(Desktop.permission))
})
```

- `Native.Permissions.window.all` — permission declarations for every privileged Window method.
- `WindowLive` and `WindowHandlersLive` — runtime layers behind the native surface.
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
