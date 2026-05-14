# Typed RPCs

Typed RPCs are declared once as Effect RPC groups and consumed from runtime handlers and React hooks.

## Contract

```ts run
import { Handlers, RpcGroup } from "../packages/bridge/src/index.js"

if (typeof RpcGroup.make !== "function" || typeof Handlers !== "function") {
  throw new Error("typed RPC helpers are unavailable")
}
```

```ts
import { Rpc, RpcGroup } from "@effect-desktop/bridge"
import { Schema } from "effect"

export const CreateNote = Rpc.make("Notes.create", {
  payload: { title: Schema.NonEmptyString },
  success: Schema.Struct({ id: Schema.String, title: Schema.String })
})

export const NotesRpcs = RpcGroup.make(CreateNote)
```

When the group is exposed through the renderer bridge, keep the `RpcGroup` as the source of truth and lower it into bridge metadata at the boundary:

```ts
import { bridgeContractFromRpcGroup } from "@effect-desktop/bridge"

export const NotesContract = bridgeContractFromRpcGroup("Notes", NotesRpcs)
```

## Generated surface

Use `Desktop.Rpc.surface(...)` when a group is part of the framework capability surface. The group stays the contract; the surface packages the layers and metadata derived from it.

```ts
import { Desktop, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

const ListNotes = Rpc.make("Notes.list", {
  success: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String }))
})

const NotesRpcs = RpcGroup.make(ListNotes)

const NotesClient =
  Context.GenericTag<DesktopRpcClient<RpcGroup.Rpcs<typeof NotesRpcs>>>("NotesClient")

export const NotesSurface = Desktop.Rpc.surface("Notes", NotesRpcs, {
  service: NotesClient,
  handlers: NotesRpcs.toLayer({
    "Notes.list": () => Effect.succeed([])
  })
})
```

The surface exposes:

- `serverLayer` for app/runtime composition;
- `clientLayer` for a generated client backed by an Effect RPC protocol;
- `testClientLayer` for deterministic tests against the same handlers;
- `schemaDocs` for endpoint, schema, capability, and support metadata;
- `contractLaws` for executable checks on tags, endpoint names, and schemas.

Use a mapped surface when the public service is not the raw generated RPC client. `ScreenSurface` does this: generated RPC calls are mapped into the durable `ScreenClient` service.

Use `Desktop.Rpc.supportedGroup(group)` when a descriptor group includes planned or platform-specific methods that are not callable in the current host. Unsupported methods stay visible in docs and descriptors, but the generated client type omits them.

## Runtime handler

```ts
export const NotesLive = NotesRpcs.toLayer({
  CreateNote: ({ title }) =>
    Effect.gen(function* () {
      const notes = yield* Notes
      return yield* notes.create(title)
    })
})
```

## Renderer boundary

React components should not run Effects manually. Use the React desktop hooks for renderer-callable clients so components observe `state` and `status` snapshots while the hook owns execution and cleanup.

Generated renderer SDKs should expose domain nouns and lowerCamel operations:

```tsx
const createNote = notes.createNote.useMutation()

createNote.run({ title: "Draft" })
```

`CreateNote` can remain the RPC tag and handler key. It should not be the property name React users type in the renderer.

## Support metadata

Native services expose the RPC group the host implements today. Planned methods stay out of the public `RpcGroup` until they have a real host path, so docs, adapters, and tests cannot mistake roadmap surface for callable API.

`WindowRpcs` follows that rule: it currently contains `Window.create` and `Window.close`.

React endpoint hooks expose `support` and `isSupported`:

```tsx
const screen = DesktopApp.useDesktop(ScreenRpcs)
const pointer = screen.getPointerPoint.useMutation()

return (
  <button disabled={!pointer.isSupported} onClick={() => pointer.run()}>
    Locate pointer
  </button>
)
```
