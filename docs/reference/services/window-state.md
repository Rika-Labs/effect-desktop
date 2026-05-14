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

| Method | Signature |
| --- | --- |
| `persist` | `(windowId, state) => Effect<void>` |
| `restore` | `(windowId) => Effect<WindowState \| undefined>` |
| `restoreAll` | `() => Effect<Record<string, WindowState>>` |
| `clear` | `(windowId?) => Effect<void>` |
| `observe` | `() => Stream<WindowStateEvent>` |

## Behavior

- `persist` writes the window record atomically.
- `restore` returns the persisted state or `undefined`.
- Off-screen rectangles snap to the primary display.
- Corrupt files are renamed to `window-state.corrupt.<timestamp>.json`; runtime continues with defaults; `corrupt-renamed` event emitted.

## Wiring it up

There is no built-in `restoreState` flag on `WindowSpec` today. To use `WindowState` in your app, wire the layer into your runtime and add a small handler wrapper around `Window.create` that calls `restore(windowId)` before opening, then subscribes to size/position changes and calls `persist(windowId, state)`. Persistence policy stays explicit rather than hidden behind a config flag.

## Related

- Tutorial: [Add a second window](../../tutorials/02-add-a-second-window.md)
- Reference: [`Window` service](../native/window.md), [`Desktop` API](../desktop-api.md)
- Source: [`packages/core/src/runtime/window-state.ts`](../../../packages/core/src/runtime/window-state.ts)
