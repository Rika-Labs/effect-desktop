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

- `WindowRpcs` — canonical renderer-callable RPC group.
- `WindowSupportedRpcs` — host-backed supported slice.
- `Window` — Effect service for runtime code.
- `WindowClient` — client-side service.
- `WindowPersistence` — native service that saves, restores, clears, and observes per-window geometry state.
- `WindowLive`, `WindowHandlersLive`, `makeWindow*Layer` helpers.
- `WindowMethodNames` for contract metadata and support checks.

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

if (WindowRpcs === undefined || !WindowMethodNames.includes("create")) {
  throw new Error("WindowRpcs or WindowMethodNames is unavailable")
}
```

## Lifecycle

Each window is a scoped resource. Closing the window closes its scope and any per-window resources (workers, watchers, settings stores) it owned. `WindowPersistence` persists per-window geometry across launches through explicit `save`, `restore`, and `clear` calls; there is no `restoreState` flag on `WindowSpec`.

## Where to go next

- [How-to: add a window](how-to/add-a-window.md)
- [Tutorial: add a second window](tutorials/02-add-a-second-window.md)
- [`Window` reference](reference/native/window.md)
