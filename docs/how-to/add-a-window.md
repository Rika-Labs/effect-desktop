---
title: How to add a window
description: Declare a window, open it from the renderer, persist its geometry.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to add a window

Windows are scoped resources owned by the host. The renderer requests one through the `Window` RPC; the framework opens it and runs your renderer entry against it.

## 1. Declare the window

In your `Desktop.make`:

```ts
import { Desktop } from "@orika/core"
import { Native } from "@orika/native"

export const App = Desktop.make({
  id: "dev.example.app",
  windows: Desktop.windows(
    Desktop.window("main", { title: "App", width: 1024, height: 720 }),
    Desktop.window("preferences", {
      title: "Preferences",
      width: 480,
      height: 360,
      renderer: "/preferences"
    })
  ),
  native: Desktop.native(Native.Window)
})
```

`windows` is a `DesktopWindowsLayer`. Build it with `Desktop.window(id, spec)`; compose multiple declarations with `Desktop.windows(...)`. The first argument to `Desktop.window` is the window id the runtime uses. Opening on launch vs. on demand is decided by your app's startup flow.

Renderer bundles that construct their own manifest should import
`WindowRendererRpcs` from `@orika/native/renderer`. `WindowRpcs` from
`@orika/native` is the full runtime/host contract, not the browser manifest
contract.

## 2. Open from the renderer

```tsx
import { useCreateWindowMutation } from "@orika/react"

function OpenPrefsButton() {
  const createWindow = useCreateWindowMutation()
  return (
    <button
      disabled={createWindow.status === "running"}
      onClick={() => createWindow.run({ title: "Preferences", renderer: "/preferences" })}
    >
      Preferences
    </button>
  )
}
```

`useCreateWindowMutation` is the React adapter's wrapper over the `Window.create` RPC. The runtime checks the capability, opens the native window, runs your renderer entry inside it, and returns a typed `WindowHandle`.

## 3. Close from the renderer

```tsx
import { useCloseCurrentWindowMutation } from "@orika/react"

function CloseButton() {
  const close = useCloseCurrentWindowMutation()
  return <button onClick={() => close.run()}>Close</button>
}
```

`useCloseCurrentWindowMutation` calls `Window.close` for the window the renderer is mounted in. The runtime tells the host to destroy it, the window's scope closes, anything it owned gets released.

To close a different window by handle, use `useCloseWindowMutation` and pass the handle.

## 4. Route between windows in the renderer

Open fixed views on distinct renderer routes, then choose the panel from the route. `useCurrentWindowId()` returns the host window resource id for native window operations; it is not the `Desktop.window(...)` declaration id.

```tsx
export function App() {
  return window.location.pathname === "/preferences" ? <PreferencesPanel /> : <MainPanel />
}
```

Same renderer entry, different route, different view. If your app already uses a router, read the route from that router instead of `window.location` directly.

## Permissions

`Window.create` and `Window.close` for the app's own windows are allowed by default. If you need to constrain which windows can open which others (e.g. a sandboxed sub-window), declare a custom capability and check it inside a wrapper handler.

## Related

- Tutorial: [Add a second window](../tutorials/02-add-a-second-window.md)
- Reference: [`Window` service](../reference/native/window.md), [`WindowState`](../reference/services/window-state.md), [React windows](../reference/react/windows.md)
- Explanation: [Resource lifecycle](../explanation/resource-lifecycle.md)
