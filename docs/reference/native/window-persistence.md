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
import { WindowPersistence, WindowPersistenceLive } from "@effect-desktop/native"
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

## Stale Display Policy

If a saved `displayId` is present and that display no longer exists, restore snaps the window to the current primary display. If the saved display still exists but the saved rectangle is no longer visible on it, restore snaps to that saved display's work area. Records without a display id keep any rectangle that intersects a current display, otherwise they snap to the primary display.

## Related

- Reference: [`Window` service](window.md), [`Screen` service](screen.md), [`WindowState`](../services/window-state.md)
- Source: [`packages/native/src/window-persistence.ts`](../../../packages/native/src/window-persistence.ts)
