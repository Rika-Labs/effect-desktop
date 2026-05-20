---
title: WindowPersistence
description: Save and restore native window geometry through Effect services.
kind: reference
audience: app-developers
effect_version: 4
---

# `WindowPersistence`

`WindowPersistence` composes the native `Window` and `Screen` services with core `WindowState`. It saves a window's bounds, fullscreen state, display id, scale factor, zoom, devtools panel id, and scroll positions.

## Import

```ts
import { WindowPersistence, WindowPersistenceLive } from "@orika/native"
```

## API

| Method    | Signature                                                                    |
| --------- | ---------------------------------------------------------------------------- |
| `save`    | `(window, options?) => Effect<void, WindowPersistenceError>`                 |
| `restore` | `(window) => Effect<WindowPersistenceRestoreResult, WindowPersistenceError>` |
| `clear`   | `(window) => Effect<void, WindowPersistenceError>`                           |
| `events`  | `(window) => Stream<WindowStateEvent, WindowPersistenceError>`               |

`WindowPersistenceLive` requires `Window`, `Screen`, and `KeyValueStore`. Use `makeWindowPersistenceLayer({ path, bundleId, now })` when tests or apps need a deterministic store path.

## Behavior

- `save` reads `Window.getBounds`, `Window.getState`, and `Screen.getDisplays`, then persists the record under the window handle id.
- `restore` reads persisted state, snaps stale or off-screen display coordinates to the current display policy, then applies `Window.setBounds` and `Window.setFullscreen`.
- `clear` validates the window through `Window.getById` before removing the selected window record.
- `events` validates the window through `Window.getById` before exposing that window's persistence events.
- Host permission, unsupported-platform, invalid input/output, and host failures are normalized to `WindowPersistenceError`.
- Storage failures from `WindowState` are reported as `storage-failed`.

The native host still enforces the underlying `Window.*` and `Screen.*` permissions before work happens. `WindowPersistence` does not add a separate permission boundary; it composes the existing host-backed services and validates clear/event access through `Window.getById`.

## Host Boundary

`WindowPersistence` does not introduce `WindowPersistence.*` host-protocol methods, Rust payload structs, or router entries. The host boundary is the existing routed method set:

- `Window.getById`
- `Window.getBounds`
- `Window.getState`
- `Window.setBounds`
- `Window.setFullscreen`
- `Screen.getDisplays`

Those methods are listed as routed in the generated [native parity matrix](parity-matrix.md). Rust protocol, router, and serde work for this service is therefore N/A unless a future change adds a dedicated persistence host method.

`WindowPersistence` also does not create a new resource handle. It accepts a live `WindowHandle` and relies on the `Window` service and `ResourceRegistry` to enforce generation-stamped, scoped handles. Stale or unknown handles fail through the underlying `Window.*` calls before persistence treats the operation as successful.

## Platform Matrix

| Platform | Status    | Notes                                                                                                                                        |
| -------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | supported | Uses the routed `Window` and `Screen` host methods. Bounds and fullscreen behavior are inherited from Tao and the native host adapter.       |
| Windows  | supported | Uses the routed `Window` and `Screen` host methods. Bounds and fullscreen behavior are inherited from Tao and the native host adapter.       |
| Linux    | partial   | Uses the routed `Window` and `Screen` host methods. Window manager and compositor behavior can affect fullscreen and restored window bounds. |

Unsupported platform behavior is inherited from the underlying `Window.*` and `Screen.*` calls and is normalized to `WindowPersistenceError` with `reason: "unsupported"`.

## Verification

- Unit coverage exercises success, stale display fallback, malformed save options before transport, permission denial, unsupported platform, host failure, invalid host output, shared-state events, and concurrent saves.
- Bridge coverage exercises `save`, `restore`, `clear`, and `events` through the same renderer bridge client layers used by applications.
- Host runtime coverage proves the underlying `Window.*` and `Screen.*` methods declare native capabilities, deny before privileged work, and emit permission audit rows.
- Rust host/protocol coverage is inherited from the routed `Window` and `Screen` methods in the parity matrix; no persistence-specific Rust method exists.
- Real native host smoke coverage is limited to the existing host startup/window smoke test. A save/restore smoke test is not wired today because the service is TypeScript composition over renderer bridge clients and the Rust smoke harness does not run a renderer-side `WindowPersistence` program.

## Stale Display Policy

If a saved `displayId` is present and that display no longer exists, restore snaps the window to the current primary display. If the saved display still exists but the saved rectangle is no longer visible on it, restore snaps to that saved display's work area. Records without a display id keep any rectangle that intersects a current display, otherwise they snap to the primary display.

## Related

- Reference: [`Window` service](window.md), [`Screen` service](screen.md), [`WindowState`](../services/window-state.md)
- Source: [`packages/native/src/window-persistence.ts`](../../../packages/native/src/window-persistence.ts)
