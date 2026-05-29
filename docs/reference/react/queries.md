---
title: Queries (React)
description: useQuery and useDesktopResource for read-shaped RPC.
kind: reference
audience: app-developers
effect_version: 4
---

# Queries

`useQuery` fetches an RPC value automatically on mount. Generated RPC query
hooks re-fetch when the input payload changes. Primitive inputs are compared by
value; JSON-serializable object inputs use their serialized data value, so inline
payloads like `{ query }` do not restart the query on every render.

## Import (per-method)

```tsx
import { AsyncResult } from "effect/unstable/reactivity"

function TodoList({ query }: { query: string }) {
  const todos = DesktopApp.useDesktop(TodoRpcs)
  const list = todos.list.useQuery()
  const filtered = todos.search.useQuery({ query })

  if (AsyncResult.isInitial(list)) {
    return <span>Loading…</span>
  }
  if (AsyncResult.isFailure(list)) {
    return <span>Failed.</span>
  }
  return (
    <ul>
      {list.value.map((todo) => (
        <li key={todo.id}>{todo.title}</li>
      ))}
    </ul>
  )
}
```

## Shape

```ts
import { AsyncResult } from "effect/unstable/reactivity"

type QueryResult<O, E> = AsyncResult.AsyncResult<O, E>
```

## Status semantics

- `AsyncResult.isInitial(result)` with `result.waiting === false` — the hook
  has not started work yet.
- `AsyncResult.isInitial(result)` with `result.waiting === true` — the query is
  running.
- `AsyncResult.isSuccess(result)` — the query completed; `result.value` is set.
- `AsyncResult.isFailure(result)` — the query failed; `result.cause` is set.

Prefer `AsyncResult.isInitial`, `AsyncResult.isSuccess`, and
`AsyncResult.isFailure` from `effect/unstable/reactivity` over reading `_tag`
directly.

## Lower-level

- `useDesktopQuery(operation, deps?)` — explicit Effect operation. Returns `DesktopQuery<A, E>` = `{ state, status, reload, cancel, reset }`. When `deps` is omitted, the operation re-runs only when `reload()` is called. When `deps` is supplied, both `deps` changes and `reload()` re-run it.
- `useDesktopAction(operation, options?)` — explicit Effect operation returning `DesktopAction<Args, A, E>` = `{ state, status, run, cancel, reset }`. See [Mutations](mutations.md) for `concurrency` semantics.
- `useDesktopResource(resource, deps?)` — tracks a `DesktopDisposable<E>` (`{ dispose(): Effect<void, E> }`); calls `dispose()` on unmount or when `deps` change. Returns `DesktopResourceState<E>` = `{ status: "idle" | "active" | "disposed" | "failure", error }`. Pass `undefined` to keep the resource slot idle.
- `useResource` — alias for `useDesktopResource`.
- `statusOf(state)` — derives the same status union from a raw `AsyncResult`.

## Conditional fetch

Generated query hooks accept `undefined` to skip the request. The hook still mounts; the query simply runs against the `undefined` input until a real payload arrives:

```ts
const result = todos.search.useQuery(searchEnabled ? { query } : undefined)
```

Pass the same object literal across renders (or memoize it) — object payloads are compared by JSON-stable identity, so `{ query }` does not restart the query on every render.

## Related

- Reference: [Mutations](mutations.md), [Streams](streams.md), [Atoms](atoms.md)
- Source: [`packages/react/src/hooks/desktop.ts`](../../../packages/react/src/hooks/desktop.ts)
