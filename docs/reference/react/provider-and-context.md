---
title: Provider and context (React)
description: ReactDesktop, DesktopProvider, useDesktopClient.
kind: reference
audience: app-developers
effect_version: 4
---

# Provider and context

`@orika/react` exposes the renderer adapter — a manifest-driven typed client provider plus the hooks that consume it.

## Import

```ts
import {
  DesktopProvider,
  ReactDesktop,
  useDesktopClient,
  useDesktop,
  createUnavailableDesktopClient,
  type DesktopClient,
  type DesktopRuntimeContext
} from "@orika/react"
```

## `ReactDesktop.from(manifest)`

Builds an adapter from a `DesktopAppManifest`. Returns a frozen value with:

- `app` — the original manifest.
- `DesktopRoot` — root component. Props: `transport?`, `rpcs?: DesktopRpcsLayer`, `children`.
- `createRoot(children, props?)` — helper that constructs `<DesktopRoot>` with `children`.
- `useDesktop(group)` — typed hooks for an `RpcGroup` declared by the manifest.

```tsx
const DesktopApp = ReactDesktop.from(Desktop.manifest(NotesApp))

export function Root() {
  return DesktopApp.createRoot(<App />, { rpcs: NotesLayer })
}

function App() {
  const notes = DesktopApp.useDesktop(NotesRpcs)
  const list = notes.list.useQuery()
  const create = notes.create.useMutation()
  // ...
}
```

`DesktopRoot` mounts a `ManagedRuntime` for the RPC client layer, resolves the current `WindowHandle` (when the manifest declares `Native.Window`), and wraps children in both the `ReactDesktopContext` and a `DesktopProvider`. It disposes the runtime on unmount.

## `DesktopProvider`

Lower-level provider component. Props: `client?: DesktopClient`, `currentWindow?: WindowHandle`, `onCleanupError?: (error, context) => void`, `children`.

`createRoot`/`DesktopRoot` wraps this internally with the resolved RPC-backed `DesktopClient`. Use it directly when wiring tests, SSR, or hosts that supply their own `DesktopClient` implementation. Omitting `client` installs an unavailable stub.

## `useDesktopClient()`

Returns the `DesktopClient` from the surrounding provider. Throws `RangeError("DesktopProvider is required before calling useDesktopClient")` when no provider is mounted.

## `useDesktop()`

Returns `Option.Option<DesktopClient>` — `Option.none()` when no provider is mounted. Use this when fallback UI needs to model the missing-provider case without throwing.

## `useDesktop(group)` (on `ReactDesktop.from(...)`)

The adapter exposes a `useDesktop(group)` that returns typed hooks for an `RpcGroup` registered in the manifest. Each generated endpoint gets `useQuery`, `useMutation`, or `useStream` based on its declared kind and carries an `RpcSupport` `support`/`isSupported` pair.

Throws `MissingDesktopContextError` if called outside a `DesktopRoot`, and `MissingDesktopRpcClientError` if `DesktopRoot` was mounted without an RPC client for the group.

## `createUnavailableDesktopClient(message?)`

Returns a `DesktopClient` whose `window.create`/`close`/`destroy` effects fail with a `HostProtocolError` of kind `"InvalidState"` (current: `"missing host bridge"` by default, overridable via `message`). Use as a placeholder during SSR or before the host bridge is connected — `usePower`/`useTheme`/`useDisplays`-style hooks will surface the failure as the `"unavailable"` status.

## Errors

- `MissingDesktopContextError` (re-exported from `@orika/core`) — `ReactDesktop.useDesktop(group)` called outside a `DesktopRoot`.
- `MissingDesktopRpcClientError` (re-exported from `@orika/core`) — `DesktopRoot` mounted without an RPC client layer that covers the requested group.

## Related

- Reference: [Mutations](mutations.md), [Queries](queries.md), [Streams](streams.md)
- Tutorial: [Build a notes app](../../tutorials/01-build-a-notes-app.md)
- Source: [`packages/react/src/desktop.tsx`](../../../packages/react/src/desktop.tsx)
