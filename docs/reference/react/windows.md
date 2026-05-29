---
title: Windows (React)
description: Hooks for creating, closing, and identifying windows.
kind: reference
audience: app-developers
effect_version: 4
---

# Window hooks

React adapter wrappers over the `Window` RPC. They read the `DesktopProvider`'s `DesktopClient` directly, so callers don't need to reach for `useDesktop(WindowRendererRpcs).create.useMutation()` explicitly. `ReactDesktop.from(...).DesktopRoot` populates that client when the manifest declares `Native.Window`.

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

Returns `Option.Option<string>` for the current host window resource id. This is the `WindowHandle.id` used by native window operations; it is not the `Desktop.window(id, ...)` registration id. Route renderer views with renderer routes, your app router, or explicit app state.

```tsx
import { Option } from "effect"
import { useCurrentWindowId } from "@orika/react"

const id = useCurrentWindowId()
return Option.match(id, {
  onNone: () => <span>pending</span>,
  onSome: (value) => <span>{value}</span>
})
```

## `useCreateWindowMutation()`

`MutationResult<WindowCreateOptions | undefined, WindowHandle, WindowError>`. Opens a new window and resolves to the resulting `WindowHandle`:

```tsx
function NewWindowButton() {
  const createWindow = useCreateWindowMutation()
  return (
    <button
      disabled={createWindow.isRunning}
      onClick={() => createWindow.run({ title: "Preferences", renderer: "/preferences" })}
    >
      Open preferences
    </button>
  )
}
```

`WindowCreateOptions` is the renderer-facing alias for `WindowCreateInput`: optional `title`, `width`, `height`, `renderer`, `parent`, `titleBarStyle`, `vibrancy`, `trafficLights`.

## `useCloseWindowMutation()` / `useCloseCurrentWindowMutation()`

`useCloseWindowMutation()` is `MutationResult<{ window: WindowHandle }, void, WindowError>` — pass the handle inside an object. `useCloseCurrentWindowMutation()` takes no input and resolves the current window from the provider (or `WindowApi.getCurrent` when the manifest exposes it):

```tsx
const close = useCloseCurrentWindowMutation()
return <button onClick={() => close.run()}>Close</button>

const closeOther = useCloseWindowMutation()
closeOther.run({ window: handle })
```

## `useDestroyWindowMutation()` / `useDestroyCurrentWindowMutation()`

Same input shape as the close variants. Destroy is the unconditional lifecycle operation that frees the host window resource; close performs the OS-level close, which may be cancelable by the host UI.

## Related

- How-to: [Add a window](../../how-to/add-a-window.md)
- Tutorial: [Add a second window](../../tutorials/02-add-a-second-window.md)
- Reference: [`Window`](../native/window.md), [`WindowState`](../services/window-state.md)
- Source: [`packages/react/src/windows.ts`](../../../packages/react/src/windows.ts), [`current-window.ts`](../../../packages/react/src/current-window.ts)
