---
title: How to define an RPC surface
description: Author an Effect RpcGroup, register handlers, and expose it through Desktop.make.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to define an RPC surface

Every renderer-callable API in Effect Desktop is an Effect `RpcGroup`. This recipe shows the four steps from a fresh contract to a working call.

## 1. Define the group

```ts
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

export class TodoError extends Schema.TaggedError<TodoError>()(
  "TodoError",
  { reason: Schema.String }
) {}

export const TodoCreate = Rpc.make("Todos.create", {
  payload: { title: Schema.String, dueAt: Schema.optional(Schema.Number) },
  success: Schema.Struct({ id: Schema.String, createdAt: Schema.Number }),
  error: TodoError
})

export const TodoList = Rpc.make("Todos.list", {
  success: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String }))
})

export const TodoRpcs = RpcGroup.make(TodoCreate, TodoList)
```

Pick `Rpc.make`'s success type carefully — it's the boundary the bridge will Schema-decode at. `payload`, `success`, `error`, and `stream` are the only fields you should set.

## 2. Implement the handlers

```ts
import { Effect } from "effect"
import { TodoRpcs, TodoError } from "./contracts.js"

export const TodoHandlersLive = TodoRpcs.toLayer({
  "Todos.create": ({ title, dueAt }) =>
    Effect.gen(function* () {
      if (title.length === 0) {
        return yield* Effect.fail(new TodoError({ reason: "title required" }))
      }
      const id = crypto.randomUUID()
      const createdAt = Date.now()
      // ... persist somewhere
      return { id, createdAt }
    }),

  "Todos.list": () => Effect.succeed([])
})
```

`RpcGroup.toLayer` accepts either:

- A handler map directly (as above) — used when handlers don't need services.
- An `Effect` that returns a handler map — used when handlers need to acquire services first (`yield* Settings`, etc.).

Forgetting a method is a compile error. Returning the wrong type is a compile error. The contract is enforced.

## 3. Add to the manifest

```ts
import { Desktop } from "@effect-desktop/core"
import { TodoRpcs } from "./contracts.js"
import { TodoHandlersLive } from "./handlers.js"

export const App = Desktop.make({
  id: "dev.example.todos",
  windows: { main: { title: "Todos" } },
  rpcs: Desktop.rpc(TodoRpcs, TodoHandlersLive)
})

export const Manifest = Desktop.manifest(App)
```

The `rpcs` array is a list of `{ group, handlers }` pairs. You can register many groups; each is independent.

## 4. Call from the renderer

```tsx
import { ReactDesktop } from "@effect-desktop/react"
import { Manifest } from "./manifest.js"
import { TodoRpcs } from "./contracts.js"

const DesktopApp = ReactDesktop.from(Manifest)

function CreateTodo() {
  const todos = DesktopApp.useDesktop(TodoRpcs)
  const create = todos.create.useMutation()

  return (
    <button
      disabled={create.status === "running"}
      onClick={() => create.run({ title: "Buy milk" })}
    >
      Add
    </button>
  )
}
```

`useMutation` for actions, `useQuery` for reads, `useStream` for streaming endpoints (`stream: true`).

## When to add capability metadata

If a handler performs privileged work (filesystem, process, secret, native invoke), annotate the RPC with capability metadata so the framework checks it before dispatch:

```ts
import { P } from "@effect-desktop/core"

export const TodoExport = Rpc.make("Todos.export", {
  payload: { path: Schema.String },
  success: Schema.Struct({ bytesWritten: Schema.Number })
}).pipe(
  P.requireFilesystemWrite()
)
```

`PermissionRegistry` checks the capability before the handler runs. The handler still receives the call only if a matching declaration permits it.

## Related

- Tutorial: [Build a notes app](../tutorials/01-build-a-notes-app.md)
- Reference: [`Desktop.Rpc`](../reference/rpc-surface.md), [React mutations](../reference/react/mutations.md)
- Explanation: [Layer-first design](../explanation/layer-first-design.md)
