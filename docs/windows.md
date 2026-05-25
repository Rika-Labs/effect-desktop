---
title: Windows
description: Native windows are scoped resources opened through the Window RPC.
kind: reference
audience: app-developers
effect_version: 4
---

# Windows

> Full references: [`reference/native/window.md`](reference/native/window.md), [`reference/services/window-state.md`](reference/services/window-state.md), [`reference/react/windows.md`](reference/react/windows.md).

Windows are native resources owned by the host and described to the runtime through typed contracts.

## Public surface

`@orika/native` exports:

- `WindowRpcs` — canonical runtime and host Window RPC group.
- `Window` — Effect service for runtime code.
- `WindowPersistence` — native service that saves, restores, clears, and observes per-window geometry state.
- `WindowHandlersLive`, `WindowSurface`, and bridge-layer helpers for runtime and renderer adapters.
- `WindowMethodNames` for contract metadata and support checks.

Browser renderer manifests use `WindowRendererRpcs` from
`@orika/native/renderer`. That subpath carries only the renderer-callable
Window RPC tags and avoids host/runtime modules.

## Common operations

The supported methods include creation, lookup, visibility, bounds, state, attention, progress, and close. Renderer code uses React helpers:

```tsx
import { useCreateWindowMutation } from "@orika/react"

export function NewWindowButton() {
  const createWindow = useCreateWindowMutation()
  return <button onClick={() => createWindow.run({ title: "New Window" })}>New</button>
}
```

## Verify Window Contract

```ts run
import { WindowMethodNames, WindowRpcs } from "../packages/native/src/index.js"
import { WindowRendererRpcs } from "../packages/native/src/renderer.js"

if (
  WindowRpcs === undefined ||
  WindowRendererRpcs === undefined ||
  !WindowMethodNames.includes("create")
) {
  throw new Error("Window RPC exports are unavailable")
}
```

## Lifecycle

Each window is a scoped resource. Closing the window closes its scope and any per-window resources (workers, watchers, settings stores) it owned. `WindowPersistence` persists per-window geometry across launches through explicit `save`, `restore`, and `clear` calls; there is no `restoreState` flag on `WindowSpec`.

## Where to go next

- [How-to: add a window](how-to/add-a-window.md)
- [Tutorial: add a second window](tutorials/02-add-a-second-window.md)
- [`Window` reference](reference/native/window.md)
