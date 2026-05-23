---
title: Windows (React)
description: Hooks for creating, closing, and identifying windows.
kind: reference
audience: app-developers
effect_version: 4
---

# Window hooks

React adapter wrappers over the `Window` RPC. Saves you from writing `useDesktop(WindowRendererRpcs).create.useMutation()` everywhere.

## Imports

```ts
import {
  useCurrentWindow,
  useCurrentWindowId,
  useCloseCurrentWindowMutation,
  useDestroyCurrentWindowMutation,
  useCreateWindowMutation,
  useCloseWindowMutation,
  useDestroyWindowMutation
} from "@orika/react"
```

If you build the renderer manifest by hand, include the browser-safe Window
group from the renderer subpath:

```ts
import { WindowRendererRpcs } from "@orika/native/renderer"

export const Manifest = {
  _tag: "DesktopAppManifest",
  id: "dev.example.app",
  windows: {},
  rpcGroups: [{ _tag: "DesktopRpcGroup", group: WindowRendererRpcs }]
} as const
```

Use `WindowRpcs` from `@orika/native` in runtime and host code. Browser
renderers should use `WindowRendererRpcs`.

## `useCurrentWindow()`

Returns `Option.Option<WindowHandle>` for the window the renderer is mounted in. It is `Option.none()` before the renderer receives its current-window context.

## `useCurrentWindowId()`

Returns `Option.Option<string>` for the current window id. Route by matching the option, not by comparing the hook result directly.

```tsx
import { Option } from "effect"
import { useCurrentWindowId } from "@orika/react"

const id = useCurrentWindowId()
return Option.match(id, {
  onNone: () => <MainPanel />,
  onSome: (value) => (value === "preferences" ? <PreferencesPanel /> : <MainPanel />)
})
```

## `useCreateWindowMutation()`

Mutation that opens a new window:

```tsx
const createWindow = useCreateWindowMutation()
createWindow.run({ title: "Preferences" })
```

## `useCloseWindowMutation()` / `useCloseCurrentWindowMutation()`

Close by handle, or close the current window:

```tsx
const close = useCloseCurrentWindowMutation()
<button onClick={() => close.run()}>Close</button>
```

## `useDestroyWindowMutation()` / `useDestroyCurrentWindowMutation()`

Destroy by handle, or destroy the current window. Destroy is the explicit lifecycle operation; `close` remains available as the compatibility alias for app code that still speaks in close semantics.

## Related

- How-to: [Add a window](../../how-to/add-a-window.md)
- Tutorial: [Add a second window](../../tutorials/02-add-a-second-window.md)
- Reference: [`Window`](../native/window.md), [`WindowState`](../services/window-state.md)
- Source: [`packages/react/src/windows.ts`](../../../packages/react/src/windows.ts), [`current-window.ts`](../../../packages/react/src/current-window.ts)
