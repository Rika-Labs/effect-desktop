---
title: Windows (React)
description: Hooks for creating, closing, and identifying windows.
kind: reference
audience: app-developers
effect_version: 4
---

# Window hooks

React adapter wrappers over the `Window` RPC. Saves you from writing `useDesktop(WindowSupportedRpcs).create.useMutation()` everywhere.

## Imports

```ts
import {
  useCurrentWindow,
  useCurrentWindowId,
  useCloseCurrentWindowMutation,
  useCreateWindowMutation,
  useCloseWindowMutation,
  windows,
  currentWindow
} from "@orika/react"
```

## `useCurrentWindow()`

Returns the `WindowHandle` for the window the renderer is mounted in (or `undefined` before context is established).

## `useCurrentWindowId()`

Returns just the id — useful for routing per-window content.

```tsx
const id = useCurrentWindowId()
return id === "preferences" ? <PreferencesPanel /> : <MainPanel />
```

## `useCreateWindowMutation()`

Mutation that opens a new window:

```tsx
const createWindow = useCreateWindowMutation()
createWindow.run({ id: "preferences", title: "Preferences" })
```

## `useCloseWindowMutation()` / `useCloseCurrentWindowMutation()`

Close by handle, or close the current window:

```tsx
const close = useCloseCurrentWindowMutation()
<button onClick={() => close.run({})}>Close</button>
```

## `windows` / `currentWindow` namespaces

Bundles the create/close hooks under one namespace if you prefer a single import.

## Related

- How-to: [Add a window](../../how-to/add-a-window.md)
- Tutorial: [Add a second window](../../tutorials/02-add-a-second-window.md)
- Reference: [`Window`](../native/window.md), [`WindowState`](../services/window-state.md)
- Source: [`packages/react/src/windows.ts`](../../../packages/react/src/windows.ts), [`current-window.ts`](../../../packages/react/src/current-window.ts)
