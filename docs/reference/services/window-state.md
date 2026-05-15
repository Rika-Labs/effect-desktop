---
title: WindowState
description: Persist per-window geometry and UI state across launches.
kind: reference
audience: app-developers
effect_version: 4
---

# `WindowState`

Persists per-window geometry and UI state across launches. Restore applies caller-provided bounds validation and display snapping. Corrupt state files are renamed and the runtime continues with defaults.

## Import

```ts
import { WindowState, type WindowStateApi } from "@effect-desktop/core"
```

## API

| Method    | Signature                           |
| --------- | ----------------------------------- |
| `persist` | `(state) => Effect<void>`           |
| `restore` | `() => Effect<Option<WindowState>>` |
| `clear`   | `() => Effect<void>`                |
| `observe` | `() => Stream<WindowStateEvent>`    |

`WindowState.window(options?)` provides this API for the current `Desktop.window(...)` services scope. The current window id comes from `DesktopWindowContext`, so callers cannot accidentally persist one window's geometry under another window id.

## Behavior

- `persist` writes the current window record atomically.
- `restore` returns the current window's persisted state or `Option.none()`.
- `clear` removes the current window record and leaves other windows intact.
- Off-screen rectangles snap to the primary display.
- Corrupt files are renamed to `window-state.corrupt.<timestamp>.json`; runtime continues with defaults; `corrupt-renamed` event emitted.

## Wiring it up

There is no built-in `restoreState` flag on `WindowSpec` today. To use `WindowState` in your app, wire `WindowState.window(...)` into the third argument of `Desktop.window(...)` and add a small handler wrapper around `Window.create` that calls `restore()` before opening, then subscribes to size/position changes and calls `persist(state)`. Persistence policy stays explicit rather than hidden behind a config flag.

## Related

- Tutorial: [Add a second window](../../tutorials/02-add-a-second-window.md)
- Reference: [`Window` service](../native/window.md), [`Desktop` API](../desktop-api.md)
- Source: [`packages/core/src/runtime/window-state.ts`](../../../packages/core/src/runtime/window-state.ts)
