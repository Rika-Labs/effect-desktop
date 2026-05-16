---
title: Provider and context (React)
description: ReactDesktop, DesktopProvider, useDesktopClient.
kind: reference
audience: app-developers
effect_version: 4
---

# Provider and context

`@effect-desktop/react` exposes the renderer adapter — a manifest-driven typed client provider plus the hooks that consume it.

## Import

```ts
import {
  DesktopProvider,
  ReactDesktop,
  useDesktopClient,
  useOptionalDesktopClient,
  useDesktop,
  createUnavailableDesktopClient,
  type DesktopClient,
  type DesktopRuntimeContext
} from "@effect-desktop/react"
```

## `ReactDesktop.from(manifest, options?)`

Builds an adapter from a manifest. Returns a value with:

- `useDesktop(group)` — typed hooks for an `RpcGroup`.
- `createRoot(children, props?)` — root wrapper that installs the context provider.
- `client` — direct access to the typed client map.

```ts
const DesktopApp = ReactDesktop.from(Manifest)

export function Root() {
  return DesktopApp.createRoot(<App />)
}

function App() {
  const notes = DesktopApp.useDesktop(NotesRpcs)
  // notes.list, notes.save, notes.delete — all typed
}
```

## `DesktopProvider`

Lower-level provider component. `ReactDesktop.from(manifest).createRoot(...)` uses this internally; you can use it directly when you need finer control over context.

## `useDesktopClient()` / `useOptionalDesktopClient()`

Returns the full bridge client map. The optional variant returns `null` if no provider is mounted (useful for fallbacks).

## `useDesktop(group)`

Returns typed hooks for an `RpcGroup`. Each method gets `useQuery`, `useMutation`, or `useStream` based on the endpoint kind.

## `createUnavailableDesktopClient()`

Stub client for when the runtime isn't reachable. All methods reject with `MissingDesktopRpcClientError`. Useful as a placeholder during SSR or before connection.

## Errors

- `MissingDesktopContextError` — hook called outside a provider.
- `MissingDesktopRpcClientError` — RPC client unavailable.

## Related

- Reference: [Mutations](mutations.md), [Queries](queries.md), [Streams](streams.md)
- Tutorial: [Build a notes app](../../tutorials/01-build-a-notes-app.md)
- Source: [`packages/react/src/desktop.tsx`](../../../packages/react/src/desktop.tsx)
