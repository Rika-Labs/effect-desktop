---
title: Window (native)
description: Native window lifecycle and state controls.
kind: reference
audience: app-developers
effect_version: 4
---

# `Window`

Native window lifecycle and state controls. Runtime and host code use `WindowRpcs`; browser renderer manifests use `WindowRendererRpcs` from `@orika/native/renderer`; React renderers normally call through the window mutation hooks.

## Import

```ts
import { Desktop } from "@orika/core"
import {
  Window,
  WindowRpcs,
  WindowMethodNames,
  Native,
  type WindowApi,
  type WindowPosition,
  type WindowSize,
  type WindowError
} from "@orika/native"
import { type WindowCreateOptions, type WindowHandle } from "@orika/native/contracts"
import { WindowRendererRpcs } from "@orika/native/renderer"
```

## Methods

| Method                   | Payload                          | Success               | Description                                                               |
| ------------------------ | -------------------------------- | --------------------- | ------------------------------------------------------------------------- |
| `create`                 | `WindowCreateOptions`            | `WindowHandle`        | Open a native window; pass `renderer: "/route"` to load a renderer route. |
| `show`                   | `WindowHandle`                   | `void`                | Make an existing window show.                                             |
| `hide`                   | `WindowHandle`                   | `void`                | Hide an existing window.                                                  |
| `focus`                  | `WindowHandle`                   | `void`                | Request focus for a window.                                               |
| `getCurrent`             | `void`                           | `WindowHandle`        | Read the focused window tracked by the runtime.                           |
| `getById`                | `WindowLookupInput`              | `WindowHandle`        | Read a tracked window by native window id.                                |
| `list`                   | `void`                           | `WindowListResult`    | List tracked open windows in creation order.                              |
| `getParent`              | `WindowHandle`                   | `WindowParentResult`  | Read the tracked parent window, when one exists.                          |
| `getChildren`            | `WindowHandle`                   | `WindowListResult`    | Read tracked child windows for a parent window.                           |
| `getBounds`              | `WindowHandle`                   | `WindowBounds`        | Read logical window bounds.                                               |
| `setBounds`              | `WindowBoundsInput`              | `WindowBounds`        | Move, resize, and return observed bounds.                                 |
| `setBoundsOnDisplay`     | `WindowDisplayBoundsInput`       | `WindowBounds`        | Move, resize, and return observed bounds relative to a display.           |
| `center`                 | `WindowHandle`                   | `WindowBounds`        | Center in the current display and return observed bounds.                 |
| `centerOnDisplay`        | `WindowDisplayInput`             | `WindowBounds`        | Center in a specific display's work area and return observed bounds.      |
| `setTitle`               | `WindowTitleInput`               | `void`                | Set the window title.                                                     |
| `setResizable`           | `WindowResizableInput`           | `void`                | Enable or disable user resizing.                                          |
| `setDecorations`         | `WindowDecorationsInput`         | `void`                | Enable or disable native window decorations.                              |
| `setTrafficLights`       | `WindowTrafficLightsInput`       | `void`                | Move macOS traffic-light controls.                                        |
| `setVibrancy`            | `WindowVibrancyInput`            | `void`                | Apply macOS window vibrancy.                                              |
| `clearVibrancy`          | `WindowHandle`                   | `void`                | Clear macOS window vibrancy.                                              |
| `setShadow`              | `WindowShadowInput`              | `void`                | Enable or disable the macOS native window shadow.                         |
| `setTitleBarStyle`       | `WindowTitleBarStyleInput`       | `void`                | Apply a macOS titlebar style.                                             |
| `setTitleBarTransparent` | `WindowTitleBarTransparentInput` | `void`                | Enable or disable macOS transparent titlebar drawing.                     |
| `setTransparent`         | `WindowTransparentInput`         | `void`                | Enable or disable macOS window transparency.                              |
| `setAlwaysOnTop`         | `WindowAlwaysOnTopInput`         | `void`                | Enable or disable always-on-top z-order.                                  |
| `setSkipTaskbar`         | `WindowSkipTaskbarInput`         | `void`                | Hide or show a window in the taskbar where supported.                     |
| `setProgress`            | `WindowProgressInput`            | `void`                | Set host task progress state for the window.                              |
| `requestAttention`       | `WindowRequestAttentionInput`    | `void`                | Ask the OS to draw attention to a window.                                 |
| `cancelAttention`        | `WindowHandle`                   | `void`                | Cancel a pending attention request where possible.                        |
| `minimize`               | `WindowHandle`                   | `WindowState`         | Minimize a window and return the host-observed state.                     |
| `maximize`               | `WindowHandle`                   | `WindowState`         | Maximize a window and return the host-observed state.                     |
| `restore`                | `WindowHandle`                   | `WindowState`         | Clear minimized, maximized, and fullscreen state.                         |
| `setFullscreen`          | `WindowFullscreenInput`          | `WindowState`         | Enter or exit borderless fullscreen.                                      |
| `setSimpleFullscreen`    | `WindowSimpleFullscreenInput`    | `WindowState`         | Enter or exit macOS simple fullscreen.                                    |
| `getState`               | `WindowHandle`                   | `WindowState`         | Read minimized, maximized, fullscreen, and simple-fullscreen state.       |
| `events`                 | `void`                           | `Stream<WindowEvent>` | Subscribe to typed registry, state, and bounds events.                    |
| `close`                  | `WindowHandle`                   | `void`                | Compatibility name for `destroy`.                                         |
| `destroy`                | `WindowHandle`                   | `void`                | Destroy a native window and close its scope.                              |

`WindowMethodNames = ["create", "close", "destroy", "show", "hide", "focus", "getCurrent", "getById", "list", "getParent", "getChildren", "getBounds", "setBounds", "setBoundsOnDisplay", "center", "centerOnDisplay", "setTitle", "setResizable", "setDecorations", "setTrafficLights", "setVibrancy", "clearVibrancy", "setShadow", "setTitleBarStyle", "setTitleBarTransparent", "setTransparent", "setAlwaysOnTop", "setSkipTaskbar", "setProgress", "requestAttention", "cancelAttention", "minimize", "maximize", "restore", "setFullscreen", "setSimpleFullscreen", "getState"]`. Bounds use logical coordinates; the host converts through the display scale factor before applying native position and size operations. Mutable title, resizable, decorations, always-on-top, progress, and attention controls are backed by Tao operations. `setTrafficLights`, `setVibrancy`, `clearVibrancy`, `setShadow`, `setTitleBarStyle`, `setTitleBarTransparent`, `setTransparent`, and `setSimpleFullscreen` are macOS-only and return typed `Unsupported` on other hosts. `setSkipTaskbar` is supported on Windows and Linux and returns typed `Unsupported` on macOS. Progress is platform-dependent: Tao reports Linux/macOS progress as app-wide rather than truly window-scoped, and Linux support depends on desktop environment support. Attention cancellation maps to Tao's `request_user_attention(None)` and is best-effort; Tao documents that it has no effect on macOS.

The placement surface is host-routed. `getBounds`, `setBounds`, and `center`
use logical-coordinate operations. `centerOnDisplay` uses the host's
`ScreenDisplay.id` to choose the monitor, then centers the current window size
inside that display's work area. On macOS, the host derives `workArea` from
AppKit `NSScreen.visibleFrame`; on Windows, it derives `workArea` from Win32
`rcWork`; on Linux, it derives `workArea` from GDK monitor work areas.
`setBounds` clips requested logical bounds to the current display work area
before applying the native move and resize commands. `setBoundsOnDisplay`
treats `bounds.x` and `bounds.y` as offsets inside the target display work
area, clips size and position to that work area, and applies the target
display's scale factor for native placement. `setBounds`, `setBoundsOnDisplay`,
`center`, and `centerOnDisplay` return the host-observed logical bounds after
the native command, so callers can compare requested and observed rectangles
when the OS or compositor adjusts placement. On macOS, `setBounds` and
`setBoundsOnDisplay` write and read the AppKit `NSWindow` content rect directly
so the command result reflects the resize accepted by AppKit instead of Tao's
asynchronous view-size cache. Native move and resize notifications are exposed
as `window-bounds-event` events with the current logical bounds.

The chrome surface is platform-typed on the existing `Window` service rather
than split behind a separate `WindowChrome` facade. `Window.create` accepts
macOS creation-time `titleBarStyle`, `vibrancy`, and `trafficLights` options.
`setDecorations` is mutable through the host on all platforms. `setTrafficLights`
mutates macOS traffic-light placement with typed unsupported behavior elsewhere.
`setVibrancy` applies the same validated macOS vibrancy materials that
`Window.create({ vibrancy })` accepts, and `clearVibrancy` removes the macOS
`NSVisualEffectView` installed by the vibrancy adapter. Both return typed
`Unsupported` on non-macOS hosts. `setTitleBarStyle` mutates macOS AppKit
titlebar style state with the same validated style literals accepted by
`Window.create({ titleBarStyle })`. `setShadow` mutates the macOS native window
shadow through Tao and returns typed `Unsupported` on Windows and Linux.
`setTitleBarTransparent` mutates the macOS titlebar background drawing flag
through Tao and returns typed `Unsupported` on Windows and Linux.
`setTransparent` mutates macOS AppKit window opacity and background-color state
and returns typed `Unsupported` on Windows and Linux. The generated parity matrix
records the per-method support status.

The state surface has command, read, and command-originated state-event support
for minimized, maximized, fullscreen, and simple-fullscreen booleans. `minimize`,
`maximize`, `restore`, `setFullscreen`, `setSimpleFullscreen`, and `getState`
are host-routed. `setFullscreen` uses Tao borderless fullscreen on all hosts.
`setSimpleFullscreen` uses Tao's macOS simple fullscreen primitive and returns
typed `Unsupported` with reason `simple-fullscreen-macos-only` on Windows and
Linux. `setFullscreen` and `setSimpleFullscreen` fail with typed `InvalidState`
when the host rejects the requested fullscreen transition; clearing macOS simple
fullscreen is idempotent when it is already clear. `minimize`, `maximize`, and
`restore` acknowledge an accepted native state request even when the immediate
Tao state readback still reflects the previous window state. Their returned
`WindowState` is the immediate host-observed snapshot, and `getState` remains
the source of truth after the native event loop settles. After a successful
state command, the Rust host publishes a `Window.Event` state snapshot with the
same immediate state returned to the caller. The host does not synthesize a
cached desired state.

The z-order and attention surface is intentionally narrower than Electron-style
window chrome. ORIKA exposes explicit window-scoped z-order,
skip-taskbar, progress, and attention commands where the host can route them.
Badge controls live on the app/taskbar-scoped `Dock` surface rather than on
individual `Window` handles. There is no separate flash command: the portable
host primitive is `requestAttention`, and cancellation remains best-effort with
platform-specific scope limits.

Window lookup is backed by host-routed native methods. `getCurrent` returns the focused tracked window, `getById` returns a tracked open window by id, `list` returns tracked open windows in host creation order, `getParent` returns the tracked parent window for a child created with `Window.create({ parent })`, and `getChildren` returns the tracked child windows for a parent. The runtime validates host lookup results against its live `ResourceRegistry` handles, so a destroyed window is removed from lookup before `Window.destroy` or compatibility `Window.close` completes.

`Window.events()` exposes the typed runtime-router window event stream through the canonical `Window.events.Event` RPC. Events are ordered by router publication order and use the router's sliding drop-oldest buffer with no replay. Registry events use `type: "window-registry-event"`: `opened`, `shown`, `hidden`, `focused`, and `closeRequested` are non-terminal, and `closed` is terminal for that window id. State events use `type: "window-state-event"` and carry `{ minimized, maximized, fullscreen, simpleFullscreen }`. Bounds events use `type: "window-bounds-event"` and carry the current logical `{ x, y, width, height }`. Bridge clients keep the raw host `Window.Event` stream as wire compatibility and first authorize the internal `Window.subscribeEvents` native permission, so denial is observable and audit-backed through `PermissionRegistry` before the stream opens. Host-originated `opened` events register a live `ResourceRegistry` window handle when one is not already known, host-originated non-terminal visibility/focus/close-request events attach a live handle when one is still registered, host-originated terminal `closed` events close the live window scope when one exists, and host-originated state and bounds events attach the fresh handle when the window is still registered. The Rust host publishes `Window.Event` for native open, explicit show/hide commands, OS-confirmed focus, native close requests, destroy transitions, native move/resize notifications, and state snapshots after successful state commands; it queues `closeRequested` events before applying the existing close policy.

The lifecycle surface is complete for the portable Tao primitives Effect
Desktop can route today. `show`, `hide`, `focus`, `destroy`, and compatibility
`close` are host-routed, and `Window.Event` reports opened, shown, hidden,
focused, `closeRequested`, and closed registry phases. Installed Tao 0.35.2
exposes `set_visible`, `set_focus`, focus observation, and `CloseRequested`
events; it does not expose a portable `blur` command or a close-request
veto/confirm decision API. ORIKA therefore does not add a `blur`
method or a close-request confirmation facade that would promise unsupported
host behavior.

`Window.create({ parent })` creates a child or owned window at host creation time. The parent must be a fresh `WindowHandle` from the same runtime; stale or unknown handles fail before host transport. The bridge sends the host `parentWindowId`, and the native host applies Tao's creation-time ownership where supported: macOS uses the parent `NSWindow`; Windows uses an owned window relationship. Hosts without a Tao parent/owner primitive return `Unsupported` when a parent is requested. `Window.getParent(child)` returns the fresh parent handle when the host still tracks one and `undefined` for root windows. `Window.getChildren(parent)` returns fresh child handles that are still open and registered. Destroying a known parent through `Window.destroy` or compatibility `Window.close` closes registered children before destroying the parent so resource scopes and `windowClosed` events are deterministic in tests and host-backed runtimes.

The ownership surface is intentionally creation-time. Installed Tao 0.35.2
exposes parent, owner, and transient relationships as `WindowBuilder` hooks
(`with_parent_window`, `with_owner_window`, and `with_transient_for`), not as a
portable dynamic reparenting or modal toggle on an existing window. Effect
Desktop therefore keeps the durable contract on `Window.create({ parent })`,
`getParent`, `getChildren`, and deterministic parent cleanup instead of adding a
shallow `WindowOwnership` facade that would report unsupported behavior for the
core operations it names.

Dynamic parent changes, a separate modal flag, host-backed ownership-specific
events, portable traffic-light placement beyond macOS, non-macOS shadow and
transparency controls, macOS skip-taskbar behavior, host-specific blur,
OS-originated simple-fullscreen change events, and a separate close-vs-destroy
host lifecycle remain reserved for later phases.

## Errors

`WindowError = HostProtocolError`. Methods return tagged variants including `InvalidArgument`, `NotFound`, `Unsupported` (with a method-specific `reason` such as `simple-fullscreen-macos-only`), `InvalidState` (host rejected the requested transition), `InvalidOutput`, `StaleHandle`, `PermissionDenied`/`PermissionRevoked`, and host-internal failures (`Internal`, `HostUnavailable`, `Timeout`). Bridge clients additionally fail with `MethodNotFound` when a host build does not export the method.

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
- `Window` — Effect service for runtime code.
- `WindowHandlersLive` — runtime handler layer behind the native surface.
- Bridge adapters reconcile host events with `ResourceRegistry` before renderer code receives them.
- Deterministic tests can provide `Window` directly with `Layer.succeed(Window)(api)`.

## Surface

`WindowSurface = DesktopRpc.surface("Window", WindowRpcGroup, options)` — schema docs and contract laws.

## Mapped vs. supported

`Window` is a **mapped surface**: the public `WindowApi` hides generated RPC calls behind durable desktop behavior. `Window.create` accepts an optional `WindowCreateOptions`, and the bridge event adapter authorizes raw host subscriptions before exposing the canonical `Window.events.Event` stream.

## Architecture-debt sweep

Architecture-debt sweep outcome for #1922: removed the internal
`AppEventRouterLive` alias. `AppEventRouter.layer` is the canonical static
layer. `AppEventRouter` and `makeAppEventRouter` remain because they own
window registry state, focused-window tracking, first-responder routing,
broadcast/targeted dispatch, event buffering, scoped subscription shutdown,
audit replay, and state observation.

## Related

- How-to: [Add a window](../../how-to/add-a-window.md)
- Tutorial: [Add a second window](../../tutorials/02-add-a-second-window.md)
- Reference: [`WindowState`](../services/window-state.md), [React windows](../react/windows.md)
- Explanation: [RPC surface vs. mapped](../../explanation/rpc-surface-vs-mapped.md)
- Source: [`packages/native/src/window.ts`](../../../packages/native/src/window.ts)
