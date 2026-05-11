# @effect-desktop/vue

Vue adapter for app-scoped Effect Desktop RPC groups.

## Purpose

`@effect-desktop/vue` turns a `Desktop.manifest(App)` value and an imported Effect
`RpcGroup` into Vue composables. The app contract stays in Effect RPC, the host owns
the transport, and Vue owns refs, scopes, and disposal.

## Public API

- `VueDesktop.from(manifest)` creates an adapter for one desktop app manifest.
- `createApp(rootComponent, options?)` creates a Vue app with desktop RPC context.
- `provideDesktop(options?)` installs desktop RPC context inside an existing setup
  scope.
- `useDesktop(group)` derives endpoints from the imported `RpcGroup`.
- Query endpoints expose `useQuery(input?)` and return a readonly `Ref`.
- Mutation endpoints expose `useMutation()` with `state`, `run`, `runPromise`, and
  `reset`.
- Stream endpoints expose `useStream(input?)` and return a readonly `Ref`.
- Every endpoint exposes `support` and `isSupported` metadata.

`options.transport` exists for tests and custom renderers. Normal desktop
applications rely on the host-installed renderer transport.

## Non-goals

- This package does not define desktop APIs. Use `Rpc.make`, `RpcGroup.make`, and
  `Desktop.Rpcs.layer(...)` in app code.
- This package does not open startup windows. Startup windows belong to
  `Desktop.make({ windows })` and the host runtime.
- This package does not expose raw bridge client maps as the normal public API.
- This package does not emulate React hooks or Solid accessors.

## Usage

```ts
import { Desktop } from "@effect-desktop/core"
import { VueDesktop } from "@effect-desktop/vue"
import { App, NotesRpcs } from "./desktop"
import Root from "./Root.vue"

const NotesDesktop = VueDesktop.from(Desktop.manifest(App))

NotesDesktop.createApp(Root).mount("#app")

export function useNotes() {
  const notes = NotesDesktop.useDesktop(NotesRpcs)
  const list = notes.list.useQuery()
  const create = notes.create.useMutation()
  return { notes, list, create }
}
```

Inside an existing app:

```ts
export default {
  setup() {
    NotesDesktop.provideDesktop()
    return {}
  }
}
```

## Testing

```bash
bun test packages/vue/src/index.test.ts
bun run typecheck
```

Tests can pass an in-memory renderer transport to `createApp` or
`provideDesktop`. Unmounting the Vue app or disposing the Vue scope closes the
renderer RPC runtime and interrupts active streams.

## Platform notes

The package is renderer-only. Native operations stay on the host side behind
Effect RPC handlers and permission checks. `vue` is a peer dependency so apps own
their Vue runtime version.

## Internal architecture

The adapter builds a renderer RPC runtime from the desktop manifest, a transport,
and `RpcClient.make(group)`. Vue `provide` stores only the derived runtime client
map. `useDesktop(group)` checks the imported `RpcGroup`, maps descriptors into
Vue-native composables, and attaches support metadata to each endpoint.
