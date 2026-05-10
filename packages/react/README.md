# @effect-desktop/react

> **Status:** Phase 6 public surface. Renderer code should use React-shaped hooks at the boundary and keep raw Effect execution out of components.

## Purpose

Thin React integration for renderer clients: `DesktopProvider`, `useDesktopClient`, `useOptionalDesktopClient`, `defineDesktopApi`, `useDesktopAction`, `useDesktopQuery`, `useDesktopStream`, `useDesktopResource`, `usePermission`, and `useWindow`.

## Public API

- `DesktopProvider` supplies a public `DesktopClient` to renderer components and creates an unavailable client when the host bridge is absent.
- `useDesktopClient` returns the required client and fails loudly when no provider is mounted.
- `useOptionalDesktopClient` and `useDesktop` return `Option.Option<DesktopClient>` for SSR and library code.
- `useWindow` returns `Option.Option<WindowHandle>` for the current renderer window.
- `defineDesktopApi` turns lowerCamel Effect operations into objects shaped like `notes.createNote.useAction()`.
- `useDesktopAction` runs user-triggered Effect commands and exposes `state`, `status`, `run`, `cancel`, and `reset`.
- `useDesktopQuery` runs lifecycle reads and exposes `state`, `status`, `reload`, `cancel`, and `reset`.
- `useDesktopStream` subscribes to an Effect stream, interrupts it from React cleanup, and retains at most 1024 emitted items by default.
- `useDesktopResource` and `useResource` dispose a handle from React cleanup.
- `usePermission` exposes the Phase 16 placeholder state.

## Dependency note

`react` is a peer dependency because host apps own their renderer runtime. `@effect-desktop/bridge`, `@effect-desktop/native`, and `effect` are package dependencies because the public hook surface exposes typed bridge/window Effect values.

## Non-goals

See `docs/SPEC.md` for the package's normative non-goals.

## Usage

```ts
import { defineDesktopApi, useDesktopClient } from "@effect-desktop/react"

export function Toolbar() {
  const desktop = useDesktopClient()
  const windowApi = defineDesktopApi(desktop.window)
  const createWindow = windowApi.create.useAction()

  if (createWindow.state._tag === "Failure") {
    return <p>{createWindow.state.message}</p>
  }

  return (
    <button
      disabled={createWindow.status === "running"}
      onClick={() => createWindow.run({ title: "Notes", width: 960, height: 640 })}
    >
      Open
    </button>
  )
}
```

Stream retention is explicit:

```ts
const output = useDesktopStream(process.stdout, {
  capacity: 128,
  onItem: (chunk) => {
    // Optional side effect for callers that project stream items elsewhere.
  }
})
```

Use `capacity: 0` for callback-only consumption. The hook rejects negative, fractional, infinite, or unsafe capacities.

## Testing

```bash
bun test
bun run typecheck
```

## Platform notes

The package is renderer-only. Native operations stay represented as Effect values supplied by the desktop client.

## Internal architecture

React context stores an optional desktop client and current window handle. Application components should use `useDesktopClient`; library and SSR code can branch on `useOptionalDesktopClient`.
