# @effect-desktop/solid

Solid adapter for app-scoped Effect Desktop RPC groups.

## Purpose

`@effect-desktop/solid` turns a `Desktop.manifest(App)` value and an imported Effect
`RpcGroup` into Solid primitives. The app contract stays in Effect RPC, the host
owns the transport, and Solid owns accessors, signals, owners, and cleanup.

## Public API

- `SolidDesktop.from(manifest)` creates an adapter for one desktop app manifest.
- `DesktopRoot` installs the scoped renderer RPC client layer for a Solid tree.
- `render(children, mount, options?)` renders a Solid tree with desktop context.
- `useDesktop(group)` derives endpoints from the imported `RpcGroup`.
- Query endpoints expose `createQuery(input?)`.
- Mutation endpoints expose `createMutation()` with `state`, `run`, `runPromise`,
  and `reset`.
- Stream endpoints expose `createStream(input?)`.
- Every endpoint exposes `support` and `isSupported` metadata.

`transport` options exist for tests and custom renderers. Normal desktop
applications rely on the host-installed renderer transport.

## Non-goals

- This package does not define desktop APIs. Use `Rpc.make`, `RpcGroup.make`, and
  `Desktop.rpc(group, handlers)` in app code (compose multiple via `Desktop.rpcs`).
- This package does not open startup windows. Startup windows belong to
  `Desktop.make({ windows })` and the host runtime.
- This package does not expose raw bridge client maps as the normal public API.
- This package does not emulate React hooks or Vue refs.

## Usage

```tsx
import { Desktop } from "@effect-desktop/core"
import { SolidDesktop } from "@effect-desktop/solid"
import { App, NotesRpcs } from "./desktop"

const NotesDesktop = SolidDesktop.from(Desktop.manifest(App))

NotesDesktop.render(() => <NotesView />, document.getElementById("app")!)

function NotesView() {
  const notes = NotesDesktop.useDesktop(NotesRpcs)
  const list = notes.list.createQuery()
  const create = notes.create.createMutation()

  return (
    <button
      disabled={!create.isSupported || create.state().status === "running"}
      onClick={() => create.run({ title: "Untitled" })}
    >
      {list().status === "success" ? list().value.length : 0}
    </button>
  )
}
```

## Testing

```bash
bun test packages/solid/src/index.test.ts
bun run typecheck
```

Tests can pass `RpcTest`-backed RPC layers to `DesktopRoot` or `render`.
Disposing the Solid owner disposes the managed renderer RPC client layer and
interrupts active streams.

## Platform notes

The package is renderer-only. Native operations stay on the host side behind
Effect RPC handlers and permission checks. `solid-js` is a peer dependency so apps
own their Solid runtime version.

## Internal architecture

The adapter builds a `ManagedRuntime` from a scoped renderer RPC client layer.
That layer uses a host transport with `RpcClient.make(group)` or test RPC layers
with `RpcTest`. Solid context stores only the derived client map.
`useDesktop(group)` checks the imported `RpcGroup`, maps descriptors into
Solid-native primitives, and attaches support metadata to each endpoint.
