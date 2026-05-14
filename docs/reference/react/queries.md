---
title: Queries (React)
description: useQuery and useDesktopResource for read-shaped RPC.
kind: reference
audience: app-developers
effect_version: 4
---

# Queries

`useQuery` fetches an RPC value automatically on mount. Re-fetches when input changes (by reference equality on the input object).

## Import (per-method)

```ts
const list = DesktopApp.useDesktop(TodoRpcs).list.useQuery()
const filtered = DesktopApp.useDesktop(TodoRpcs).search.useQuery({ query })
```

## Shape

```ts
interface QueryResult<O, E> {
  readonly status: "pending" | "loading" | "success" | "error"
  readonly value?: O
  readonly error?: E
  readonly refetch: () => Promise<void>
}
```

## Status semantics

- `"pending"` — no fetch yet (input is undefined or initial render).
- `"loading"` — fetch in flight.
- `"success"` — completed; `value` is set.
- `"error"` — failed; `error` is set.

## Lower-level

- `useDesktopQuery(endpoint, input?, options?)` — same shape, more control.
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
