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

| Method             | Payload                       | Success            | Description                                        |
| ------------------ | ----------------------------- | ------------------ | -------------------------------------------------- |
| `create`           | `WindowCreateOptions`         | `WindowHandle`     | Open a native window.                              |
| `show`             | `WindowHandle`                | `void`             | Make an existing window show.                      |
| `hide`             | `WindowHandle`                | `void`             | Hide an existing window.                           |
| `focus`            | `WindowHandle`                | `void`             | Request focus for a window.                        |
| `getCurrent`       | `void`                        | `WindowHandle`     | Read the focused window tracked by the runtime.    |
| `getById`          | `WindowLookupInput`           | `WindowHandle`     | Read a tracked window by native window id.         |
| `list`             | `void`                        | `WindowListResult` | List tracked open windows in creation order.       |
| `getBounds`        | `WindowHandle`                | `WindowBounds`     | Read logical window bounds.                        |
| `setBounds`        | `WindowBoundsInput`           | `void`             | Move and resize a window.                          |
| `center`           | `WindowHandle`                | `void`             | Center in the current display.                     |
| `setTitle`         | `WindowTitleInput`            | `void`             | Set the window title.                              |
| `setResizable`     | `WindowResizableInput`        | `void`             | Enable or disable user resizing.                   |
| `setDecorations`   | `WindowDecorationsInput`      | `void`             | Enable or disable native window decorations.       |
| `setAlwaysOnTop`   | `WindowAlwaysOnTopInput`      | `void`             | Enable or disable always-on-top z-order.           |
| `setProgress`      | `WindowProgressInput`         | `void`             | Set host task progress state for the window.       |
| `requestAttention` | `WindowRequestAttentionInput` | `void`             | Ask the OS to draw attention to a window.          |
| `cancelAttention`  | `WindowHandle`                | `void`             | Cancel a pending attention request where possible. |
| `minimize`         | `WindowHandle`                | `void`             | Minimize a window.                                 |
| `maximize`         | `WindowHandle`                | `void`             | Maximize a window.                                 |
| `restore`          | `WindowHandle`                | `void`             | Clear minimized, maximized, and fullscreen state.  |
| `setFullscreen`    | `WindowFullscreenInput`       | `void`             | Enter or exit borderless fullscreen.               |
| `getState`         | `WindowHandle`                | `WindowState`      | Read minimized, maximized, and fullscreen state.   |
| `close`            | `WindowHandle`                | `void`             | Compatibility name for `destroy`.                  |
| `destroy`          | `WindowHandle`                | `void`             | Destroy a native window and close its scope.       |

`WindowMethodNames = ["create", "close", "destroy", "show", "hide", "focus", "getCurrent", "getById", "list", "getBounds", "setBounds", "center", "setTitle", "setResizable", "setDecorations", "setAlwaysOnTop", "setProgress", "requestAttention", "cancelAttention", "minimize", "maximize", "restore", "setFullscreen", "getState"]`. Bounds use logical coordinates; the host converts through the display scale factor before applying Tao position and size operations. Mutable title, resizable, decorations, always-on-top, progress, and attention controls are backed by Tao operations. Progress is platform-dependent: Tao reports Linux/macOS progress as app-wide rather than truly window-scoped, and Linux support depends on desktop environment support. Attention cancellation maps to Tao's `request_user_attention(None)` and is best-effort; Tao documents that it has no effect on macOS.

The placement surface is not complete. `getBounds`, `setBounds`, and `center`
are host-routed logical-coordinate operations, but Effect Desktop does not yet
expose display-relative placement, work-area clipping, or move/resize state
events. The current Screen adapter reports `workArea` from Tao monitor bounds,
so placement code cannot yet distinguish reserved OS work areas from full
display bounds.

The chrome surface is not complete. `Window.create` accepts macOS creation-time
`titleBarStyle`, `vibrancy`, and `trafficLights` options, and `setDecorations`
is mutable through the host. Effect Desktop does not yet expose a
`WindowChrome` service, mutable titlebar-style or vibrancy commands, shadow or
transparency controls, mutable traffic-light placement, or a platform support
matrix for those chrome features.

The state surface has command and read support, but not a dedicated state-change
event stream. `minimize`, `maximize`, `restore`, `setFullscreen`, and `getState`
are host-routed; Effect Desktop does not yet expose events that prove state
transitions agree with reads, and macOS simple fullscreen is not modeled
separately from borderless fullscreen.

The z-order and attention surface is not complete Electron-style window chrome.
Effect Desktop does not yet expose window-scoped skip-taskbar, badge, flash, or
attention lifecycle events, and the existing progress and attention controls
must be treated as host-routed best-effort operations with platform-specific
scope limits.

Window lookup is backed by host-routed native methods. `getCurrent` returns the focused tracked window, `getById` returns a tracked open window by id, and `list` returns tracked open windows in host creation order. The runtime validates host lookup results against its live `ResourceRegistry` handles, so a destroyed window is removed from lookup before `Window.destroy` or compatibility `Window.close` completes.

`Window.events()` exposes the typed runtime-router window registry stream to renderer clients through `Window.Event`. Events are ordered by router publication order and use the router's sliding drop-oldest buffer with no replay. `opened` and `focused` events are non-terminal; `closed` is terminal for that window id. Event subscription is gated by the internal `Window.subscribeEvents` native permission before the bridge opens the stream, so denial is observable and audit-backed through `PermissionRegistry`. Host-originated `opened` events register a live `ResourceRegistry` window handle when one is not already known, and host-originated terminal `closed` events close the live window scope when one exists. The Rust host also publishes `Window.Event` for native open, OS-confirmed focus, and destroy transitions, and queues closed events when handling native close requests before applying the existing exit policy.

The lifecycle surface is not complete. `show`, `hide`, `focus`, `destroy`, and
compatibility `close` are host-routed, and `Window.Event` reports opened,
focused, and closed registry phases. Effect Desktop does not yet expose a
portable `blur` command, visibility-change events for show/hide, or a separate
OS close-request veto/confirm contract.

`Window.create({ parent })` creates a child or owned window at host creation time. The parent must be a fresh `WindowHandle` from the same runtime; stale or unknown handles fail before host transport. The bridge sends the host `parentWindowId`, and the native host applies Tao's creation-time ownership where supported: macOS uses the parent `NSWindow`; Windows uses an owned window relationship. Hosts without a Tao parent/owner primitive return `Unsupported` when a parent is requested. Destroying a known parent through `Window.destroy` or compatibility `Window.close` closes registered children before destroying the parent so resource scopes and `windowClosed` events are deterministic in tests and host-backed runtimes.

This is not a complete modal ownership API. Effect Desktop does not yet expose a
`WindowOwnership` service, runtime `setParent`, modal enable/disable, owner
lookup, parent/child relationship query, or a host event stream dedicated to
ownership changes.

Dynamic parent changes, a separate modal flag, owner lookup, host-backed parent/child lifecycle events, mutable titlebar style, vibrancy, shadows, transparency, traffic lights, skip-taskbar, badge, flash, blur, simple fullscreen, and a separate close-vs-destroy host lifecycle remain reserved for later phases.

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
