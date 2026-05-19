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

| Method                | Payload                       | Success              | Description                                                         |
| --------------------- | ----------------------------- | -------------------- | ------------------------------------------------------------------- |
| `create`              | `WindowCreateOptions`         | `WindowHandle`       | Open a native window.                                               |
| `show`                | `WindowHandle`                | `void`               | Make an existing window show.                                       |
| `hide`                | `WindowHandle`                | `void`               | Hide an existing window.                                            |
| `focus`               | `WindowHandle`                | `void`               | Request focus for a window.                                         |
| `getCurrent`          | `void`                        | `WindowHandle`       | Read the focused window tracked by the runtime.                     |
| `getById`             | `WindowLookupInput`           | `WindowHandle`       | Read a tracked window by native window id.                          |
| `list`                | `void`                        | `WindowListResult`   | List tracked open windows in creation order.                        |
| `getParent`           | `WindowHandle`                | `WindowParentResult` | Read the tracked parent window, when one exists.                    |
| `getChildren`         | `WindowHandle`                | `WindowListResult`   | Read tracked child windows for a parent window.                     |
| `getBounds`           | `WindowHandle`                | `WindowBounds`       | Read logical window bounds.                                         |
| `setBounds`           | `WindowBoundsInput`           | `void`               | Move and resize a window.                                           |
| `center`              | `WindowHandle`                | `void`               | Center in the current display.                                      |
| `centerOnDisplay`     | `WindowDisplayInput`          | `void`               | Center in a specific display's work area.                           |
| `setTitle`            | `WindowTitleInput`            | `void`               | Set the window title.                                               |
| `setResizable`        | `WindowResizableInput`        | `void`               | Enable or disable user resizing.                                    |
| `setDecorations`      | `WindowDecorationsInput`      | `void`               | Enable or disable native window decorations.                        |
| `setTrafficLights`    | `WindowTrafficLightsInput`    | `void`               | Move macOS traffic-light controls.                                  |
| `setVibrancy`         | `WindowVibrancyInput`         | `void`               | Apply macOS window vibrancy.                                        |
| `setShadow`           | `WindowShadowInput`           | `void`               | Enable or disable the macOS native window shadow.                   |
| `setAlwaysOnTop`      | `WindowAlwaysOnTopInput`      | `void`               | Enable or disable always-on-top z-order.                            |
| `setSkipTaskbar`      | `WindowSkipTaskbarInput`      | `void`               | Hide or show a window in the taskbar where supported.               |
| `setProgress`         | `WindowProgressInput`         | `void`               | Set host task progress state for the window.                        |
| `requestAttention`    | `WindowRequestAttentionInput` | `void`               | Ask the OS to draw attention to a window.                           |
| `cancelAttention`     | `WindowHandle`                | `void`               | Cancel a pending attention request where possible.                  |
| `minimize`            | `WindowHandle`                | `void`               | Minimize a window.                                                  |
| `maximize`            | `WindowHandle`                | `void`               | Maximize a window.                                                  |
| `restore`             | `WindowHandle`                | `void`               | Clear minimized, maximized, and fullscreen state.                   |
| `setFullscreen`       | `WindowFullscreenInput`       | `void`               | Enter or exit borderless fullscreen.                                |
| `setSimpleFullscreen` | `WindowSimpleFullscreenInput` | `void`               | Enter or exit macOS simple fullscreen.                              |
| `getState`            | `WindowHandle`                | `WindowState`        | Read minimized, maximized, fullscreen, and simple-fullscreen state. |
| `close`               | `WindowHandle`                | `void`               | Compatibility name for `destroy`.                                   |
| `destroy`             | `WindowHandle`                | `void`               | Destroy a native window and close its scope.                        |

`WindowMethodNames = ["create", "close", "destroy", "show", "hide", "focus", "getCurrent", "getById", "list", "getParent", "getChildren", "getBounds", "setBounds", "center", "centerOnDisplay", "setTitle", "setResizable", "setDecorations", "setTrafficLights", "setVibrancy", "setShadow", "setAlwaysOnTop", "setSkipTaskbar", "setProgress", "requestAttention", "cancelAttention", "minimize", "maximize", "restore", "setFullscreen", "setSimpleFullscreen", "getState"]`. Bounds use logical coordinates; the host converts through the display scale factor before applying Tao position and size operations. Mutable title, resizable, decorations, always-on-top, progress, and attention controls are backed by Tao operations. `setTrafficLights`, `setVibrancy`, `setShadow`, and `setSimpleFullscreen` are macOS-only and return typed `Unsupported` on other hosts. `setSkipTaskbar` is supported on Windows and Linux and returns typed `Unsupported` on macOS. Progress is platform-dependent: Tao reports Linux/macOS progress as app-wide rather than truly window-scoped, and Linux support depends on desktop environment support. Attention cancellation maps to Tao's `request_user_attention(None)` and is best-effort; Tao documents that it has no effect on macOS.

The placement surface is not complete. `getBounds`, `setBounds`, and `center`
are host-routed logical-coordinate operations. `centerOnDisplay` uses the host's
`ScreenDisplay.id` to choose the monitor, then centers the current window size
inside that display's work area. On macOS, the host derives `workArea` from
AppKit `NSScreen.visibleFrame`; on Windows and Linux, Tao does not expose work
areas yet, so `workArea` still matches the full monitor bounds. Effect Desktop
does not yet expose general display-relative placement, work-area clipping for
arbitrary bounds, or move/resize state events.

The chrome surface is not complete. `Window.create` accepts macOS creation-time
`titleBarStyle`, `vibrancy`, and `trafficLights` options, `setDecorations` is
mutable through the host, and `setTrafficLights` mutates macOS traffic-light
placement with typed unsupported behavior elsewhere. `setVibrancy` applies the
same validated macOS vibrancy materials that `Window.create({ vibrancy })`
accepts and returns typed `Unsupported` on non-macOS hosts. Effect Desktop does
not yet expose a `WindowChrome` service, mutable titlebar-style commands,
transparency controls, vibrancy clearing, or a complete platform support matrix
for those chrome features. `setShadow` mutates the macOS native window shadow
through Tao and returns typed `Unsupported` on Windows and Linux.

The state surface has command, read, and state-event support for host-tracked
minimized, maximized, fullscreen, and simple-fullscreen booleans. `minimize`,
`maximize`, `restore`, `setFullscreen`, `setSimpleFullscreen`, and `getState`
are host-routed. `setFullscreen` uses Tao borderless fullscreen on all hosts.
`setSimpleFullscreen` uses Tao's macOS simple fullscreen primitive and returns
typed `Unsupported` with reason `simple-fullscreen-macos-only` on Windows and
Linux. After a successful state command, the Rust host updates its state source
and publishes a `Window.Event` state snapshot with the same shape as `getState`,
so renderer subscribers can compare the event payload with a follow-up read.

The z-order and attention surface is not complete Electron-style window chrome.
Effect Desktop exposes `setSkipTaskbar` on Windows and Linux, but does not yet
expose macOS skip-taskbar behavior, window-scoped badge, flash, or attention
lifecycle events. Existing progress and attention controls must be treated as
host-routed best-effort operations with platform-specific scope limits.

Window lookup is backed by host-routed native methods. `getCurrent` returns the focused tracked window, `getById` returns a tracked open window by id, `list` returns tracked open windows in host creation order, `getParent` returns the tracked parent window for a child created with `Window.create({ parent })`, and `getChildren` returns the tracked child windows for a parent. The runtime validates host lookup results against its live `ResourceRegistry` handles, so a destroyed window is removed from lookup before `Window.destroy` or compatibility `Window.close` completes.

`Window.events()` exposes the typed runtime-router window event stream to renderer clients through `Window.Event`. Events are ordered by router publication order and use the router's sliding drop-oldest buffer with no replay. Registry events use `type: "window-registry-event"`: `opened`, `shown`, `hidden`, and `focused` are non-terminal, and `closed` is terminal for that window id. State events use `type: "window-state-event"` and carry `{ minimized, maximized, fullscreen, simpleFullscreen }`. Event subscription is gated by the internal `Window.subscribeEvents` native permission before the bridge opens the stream, so denial is observable and audit-backed through `PermissionRegistry`. Host-originated `opened` events register a live `ResourceRegistry` window handle when one is not already known, host-originated non-terminal visibility/focus events attach a live handle when one is still registered, host-originated terminal `closed` events close the live window scope when one exists, and host-originated state events attach the fresh handle when the window is still registered. The Rust host publishes `Window.Event` for native open, explicit show/hide commands, OS-confirmed focus, destroy transitions, and state snapshots after successful state commands; it also queues closed events when handling native close requests before applying the existing exit policy.

The lifecycle surface is not complete. `show`, `hide`, `focus`, `destroy`, and
compatibility `close` are host-routed, and `Window.Event` reports opened,
shown, hidden, focused, and closed registry phases. Effect Desktop does not yet
expose a portable `blur` command or a separate OS close-request veto/confirm
contract.

`Window.create({ parent })` creates a child or owned window at host creation time. The parent must be a fresh `WindowHandle` from the same runtime; stale or unknown handles fail before host transport. The bridge sends the host `parentWindowId`, and the native host applies Tao's creation-time ownership where supported: macOS uses the parent `NSWindow`; Windows uses an owned window relationship. Hosts without a Tao parent/owner primitive return `Unsupported` when a parent is requested. `Window.getParent(child)` returns the fresh parent handle when the host still tracks one and `undefined` for root windows. `Window.getChildren(parent)` returns fresh child handles that are still open and registered. Destroying a known parent through `Window.destroy` or compatibility `Window.close` closes registered children before destroying the parent so resource scopes and `windowClosed` events are deterministic in tests and host-backed runtimes.

This is not a complete modal ownership API. Effect Desktop does not yet expose a
`WindowOwnership` service, runtime `setParent`, modal enable/disable, owner
lookup, or a host event stream dedicated to ownership changes.

Dynamic parent changes, a separate modal flag, owner lookup, host-backed parent/child lifecycle events, mutable titlebar style, vibrancy clearing, transparency, portable traffic-light placement beyond macOS, non-macOS shadow controls, macOS skip-taskbar behavior, badge, flash, blur, OS-originated simple-fullscreen change events, and a separate close-vs-destroy host lifecycle remain reserved for later phases.

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
