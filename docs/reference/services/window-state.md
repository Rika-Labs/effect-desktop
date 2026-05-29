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
import {
  WindowState,
  type WindowStateApi,
  WindowStateRecord,
  WindowStateEvent,
  makeWindowState,
  defaultWindowStatePath
} from "@orika/core/runtime/window-state"
```

`WindowState` is reached through the `@orika/core/runtime/window-state` subpath; it is not part of `@orika/core`'s top-level barrel.

## API

| Method    | Signature                                                      |
| --------- | -------------------------------------------------------------- |
| `persist` | `(state: WindowStateRecord) => Effect<void, WindowStateError>` |
| `restore` | `() => Effect<Option<WindowStateRecord>, WindowStateError>`    |
| `clear`   | `() => Effect<void, WindowStateError>`                         |
| `observe` | `() => Stream<WindowStateEvent>`                               |

`WindowState.window(options?)` returns a `Layer<WindowState, WindowStateInvalidArgumentError, WindowContext | KeyValueStore>` that resolves `WindowContext.registrationId` as the current window id, so callers cannot accidentally persist one window's geometry under another window id. `WindowStateLive` is `WindowState.window()` with default options.

## Behavior

- `persist` writes the current window record into the shared `WindowStateStore` through `KeyValueStore`, serialized by a per-store `Semaphore` so concurrent persists across windows do not interleave reads and writes.
- `restore` returns the current window's persisted state or `Option.none()`. When `displays` are provided in options, the bounds are snapped to a visible display before being returned.
- `clear` removes the current window record and leaves other windows in the store intact.
- `WindowStateRecord` carries `x`, `y`, `width`, `height`, optional `displayId`, `isFullScreen`, `scaleFactor`, `zoom`, optional `devtoolsPanel`, and optional `scrollPositions`.
- Off-screen rectangles snap to the primary display (or the first display when no primary is flagged). A record's saved `displayId`, when set, is preserved in the snapped record and replaced with the target display's id only when the saved display is gone.
- A corrupt store entry triggers a `corrupt-renamed` event with a notional `window-state.corrupt.<timestamp>.json` path; the corrupt entry is removed from `KeyValueStore` and the runtime continues with defaults. `now` (or `Clock.currentTimeMillis`) supplies the timestamp; non-finite or negative timestamps fail with `WindowStateReadFailed` and leave the corrupt entry in place.

## Errors

`WindowStateError` is a union of `WindowStateReadFailed`, `WindowStateWriteFailed`, `WindowStateCorruptRenamed`, and `InvalidArgument` (`WindowStateInvalidArgumentError`). All four are tagged errors; window id validation rejects empty strings, whitespace-only ids, and C0/DEL control bytes; bundle id validation rejects empty strings, `.`/`..`, ids containing `..`, path separators (`/ \ :`), and C0/DEL control bytes — before any read.

## Wiring it up

There is no built-in `restoreState` flag on `WindowSpec` today. `WindowSpec` accepts `title`, optional `width`, optional `height`, and optional `renderer`; nothing else. Choose one of:

- Use `WindowPersistence` from `@orika/native` when the renderer or runtime already has the `Window` and `Screen` native services. It composes `WindowState`, reads the live bounds, and applies them through `Window.setBounds` and `Window.setFullscreen` for you.
- Wire `WindowState.window(options?)` directly into the `services` Layer passed as the third argument to `Desktop.window(id, spec, services)`. The supervisor provides `WindowContext` and `ResourceOwner` for that scope, so the only extra requirement to supply is a `KeyValueStore` (and any options like `displays`). With `WindowStateInvalidArgumentError` in the error channel, the Layer typically needs `Layer.orDie` (or equivalent) before it satisfies the supervisor's `Layer<never, never, _>` services slot.

## Related

- Tutorial: [Add a second window](../../tutorials/02-add-a-second-window.md)
- Reference: [`Window` service](../native/window.md), [`Desktop` API](../desktop-api.md)
- Source: [`packages/core/src/runtime/window-state.ts`](../../../packages/core/src/runtime/window-state.ts)
