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
import { WindowState, type WindowStateApi } from "@orika/core"
```

## API

| Method    | Signature                           |
| --------- | ----------------------------------- |
| `persist` | `(state) => Effect<void>`           |
| `restore` | `() => Effect<Option<WindowState>>` |
| `clear`   | `() => Effect<void>`                |
| `observe` | `() => Stream<WindowStateEvent>`    |

`WindowState.window(options?)` provides this API for the current `Desktop.window(...)` services scope. The current window id comes from `WindowContext`, so callers cannot accidentally persist one window's geometry under another window id.

## Behavior

- `persist` writes the current window record atomically.
- `restore` returns the current window's persisted state or `Option.none()`.
- `clear` removes the current window record and leaves other windows intact.
- Off-screen rectangles snap to the primary display.
- Records may include `displayId`; if that display is gone on restore, the rectangle snaps to the current primary display and the restored record uses the current display id.
- Corrupt files are renamed to `window-state.corrupt.<timestamp>.json`; runtime continues with defaults; `corrupt-renamed` event emitted.

## Wiring it up

There is no built-in `restoreState` flag on `WindowSpec` today. Runtime code that already has native access can use `WindowPersistence` from `@orika/native`; lower-level core code can wire `WindowState.window(...)` into the third argument of `Desktop.window(...)` and provide its own capture/apply policy.

## Related

- Tutorial: [Add a second window](../../tutorials/02-add-a-second-window.md)
- Reference: [`Window` service](../native/window.md), [`Desktop` API](../desktop-api.md)
- Source: [`packages/core/src/runtime/window-state.ts`](../../../packages/core/src/runtime/window-state.ts)
