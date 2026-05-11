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

export const CreateNote = Rpc.make("CreateNote", {
  payload: { title: Schema.NonEmptyString },
  success: Schema.Struct({ id: Schema.String, title: Schema.String })
})

export const NotesRpcs = RpcGroup.make(CreateNote)
```

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
const createNote = notes.createNote.useAction()

createNote.run({ title: "Draft" })
```

`CreateNote` can remain the RPC tag and handler key. It should not be the property name React users type in the renderer.
