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

```ts
const list = DesktopApp.useDesktop(TodoRpcs).list.useQuery()
const filtered = DesktopApp.useDesktop(TodoRpcs).search.useQuery({ query })
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

- `useDesktopQuery(operation, deps?)` — explicit Effect operation and React
  dependency list; returns `{ state, status, reload, cancel, reset }`.
- `useDesktopResource(endpoint, input?, options?)` — auto-fetch resource with `dispose` semantics.
- `useResource(effect, options?)` — generic resource hook for any Effect.

## Conditional fetch

Pass `undefined` as input to pause:

```ts
const result = useQuery(searchEnabled ? { query } : undefined)
```

## Related

- Reference: [Mutations](mutations.md), [Streams](streams.md), [Atoms](atoms.md)
- Source: [`packages/react/src/hooks/desktop.ts`](../../../packages/react/src/hooks/desktop.ts)
