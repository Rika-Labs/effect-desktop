# @effect-desktop/react

React adapter for app-scoped Effect Desktop RPC groups.

## Purpose

`@effect-desktop/react` turns a `Desktop.manifest(App)` value and an imported Effect
`RpcGroup` into React hooks. The app contract stays in Effect RPC, the host owns the
transport, and React owns component state and cleanup.

## Public API

- `ReactDesktop.from(manifest)` creates an adapter for one desktop app manifest.
- `DesktopRoot` installs the scoped renderer RPC client layer for a React tree.
- `createRoot(children, props?)` creates the same provider element without exposing
  the context.
- `useDesktop(group)` derives endpoints from the imported `RpcGroup`.
- Query endpoints expose `useQuery(input?)`.
- Mutation endpoints expose `useMutation()`.
- Stream endpoints expose `useStream(input?, options?)`.
- Every endpoint exposes `support` and `isSupported` metadata.
- `windows.create.useMutation()` and `windows.close.useMutation()` are the supported built-in Window helpers.
- `currentWindow.close.useMutation()` closes the current renderer window when a current handle is present.
- `useDesktopStream`, `useResource`, `usePermission`, `useWindow`, and the low-level
  `DesktopProvider` remain explicit lower-level hooks for renderer clients that need them.

Unsupported Window title mutation helpers are not exported. Use descriptor support metadata from the imported `RpcGroup` before presenting native window actions.

`DesktopRoot` accepts an optional `transport` for tests and custom renderers. Normal
desktop applications do not pass client maps by hand; the host installs the renderer
transport and the adapter derives clients from the manifest.

## Non-goals

- This package does not define desktop APIs. Use `Rpc.make`, `RpcGroup.make`, and
  `Desktop.rpc(group, handlers)` in app code (compose multiple via `Desktop.rpcs`).
- This package does not open startup windows. Startup windows belong to
  `Desktop.make({ windows })` and the host runtime.
- This package does not expose raw bridge client maps as the normal public API.
- This package does not copy Vue, Solid, Next, or Astro lifecycle semantics.

## Usage

```tsx
import { Desktop } from "@effect-desktop/core"
import { ReactDesktop } from "@effect-desktop/react"
import { App, NotesRpcs } from "./desktop"

const NotesDesktop = ReactDesktop.from(Desktop.manifest(App))

export function Root() {
  return NotesDesktop.createRoot(<NotesView />)
}

function NotesView() {
  const notes = NotesDesktop.useDesktop(NotesRpcs)
  const list = notes.list.useQuery()
  const create = notes.create.useMutation()

  return (
    <button
      disabled={!create.isSupported || create.status === "running"}
      onClick={() => create.run({ title: "Untitled" })}
    >
      {list.status === "success" ? list.value.length : 0}
    </button>
  )
}
```

Stream retention is explicit:

```tsx
const tail = notes.tail.useStream(undefined, {
  capacity: 128,
  onItem: (line) => {
    // Optional projection into app-owned state.
  }
})
```

Use `capacity: 0` for callback-only consumption. The hook rejects negative,
fractional, infinite, or unsafe capacities.

## Testing

```bash
bun test packages/react/src/index.test.ts
bun run typecheck
```

Tests can pass `RpcTest`-backed RPC layers to `DesktopRoot` or `createRoot`.
Production code should use the host-installed transport.

## Platform notes

The package is renderer-only. Native operations stay on the host side behind
Effect RPC handlers and permission checks.

## Internal architecture

The adapter builds a `ManagedRuntime` from a scoped renderer RPC client layer.
That layer uses a host transport with `RpcClient.make(group)` or test RPC layers
with `RpcTest`. React context stores only the derived client map.
`useDesktop(group)` checks the imported `RpcGroup`, maps descriptors into
React-native hooks, and attaches support metadata to each endpoint. Provider
unmount disposes the managed runtime so stream clients are interrupted.
