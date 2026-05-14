---
title: Mutations (React)
description: useMutation for fire-on-call RPC actions.
kind: reference
audience: app-developers
effect_version: 4
---

# Mutations

`useMutation` runs an RPC action when you call `.run(input)`. It exposes typed status, value, and error.

## Import (per-method)

```ts
const create = DesktopApp.useDesktop(TodoRpcs).create.useMutation()
```

## Shape

```ts
interface MutationResult<I, O, E> {
  readonly status: "idle" | "running" | "error" | "success"
  readonly value?: O
  readonly error?: E
  readonly run: (input: I) => Promise<O>
  readonly isRunning: boolean
}
```

## Example

```tsx
const save = DesktopApp.useDesktop(NotesRpcs).save.useMutation()

return (
  <>
    <button disabled={save.status === "running"} onClick={() => save.run({ id, body })}>
      {save.status === "running" ? "Saving…" : "Save"}
    </button>
    {save.status === "error" && <p>Error: {save.error.reason}</p>}
  </>
)
```

## Pattern: typed error narrowing

```tsx
{save.status === "error" && save.error._tag === "NoteNotFound" && (
  <p>Note not found.</p>
)}
```

TypeScript narrows on `_tag` exhaustively because the contract declared the closed error union.

## Pattern: refetch a query after mutation

```ts
await save.run({ ... })
list.refetch()
```

## Lower-level

`useDesktopAction(endpoint, options?)` exposes the same shape with `concurrency`, `retry`, and per-call options.

`DesktopActionConcurrency`: `"replace"` (cancel pending), `"queue"` (serialize), `"all"` (parallel).

## Related

- Reference: [Queries](queries.md), [Streams](streams.md)
- Source: [`packages/react/src/mutation.ts`](../../../packages/react/src/mutation.ts)
