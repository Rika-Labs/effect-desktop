---
title: Mutations (React)
description: useMutation for fire-on-call RPC actions.
kind: reference
audience: app-developers
effect_version: 4
---

# Mutations

`useMutation` runs an RPC action when you call `.run(input)`. It exposes typed status and an `AsyncResult` state. Use `.runPromise(input)` when you need to await completion or read the success value.

## Import (per-method)

```ts
const create = DesktopApp.useDesktop(TodoRpcs).create.useMutation()
```

## Shape

```ts
interface MutationResult<I, A, E> {
  readonly state: AsyncResult.AsyncResult<A, E>
  readonly status: "idle" | "running" | "success" | "failure" | "canceled" | "unavailable"
  readonly run: (input: I) => void
  readonly runPromise: (input: I) => Promise<Exit.Exit<A, E>>
  readonly reset: () => void
  readonly isIdle: boolean
  readonly isRunning: boolean
  readonly isSuccess: boolean
  readonly isFailure: boolean // true for both "failure" and "unavailable"
}
```

When the payload type is `void` or `undefined`, `run` and `runPromise` take no argument.

## Example

```tsx
const save = DesktopApp.useDesktop(NotesRpcs).save.useMutation()

return (
  <>
    <button disabled={save.status === "running"} onClick={() => save.run({ id, body })}>
      {save.isRunning ? "Saving…" : "Save"}
    </button>
    {save.isFailure && <p>Save failed.</p>}
  </>
)
```

## Pattern: await completion

```ts
import { Exit } from "effect"

const exit = await save.runPromise({ id, body })
if (Exit.isSuccess(exit)) {
  list.refetch()
}
```

## Pattern: fire-and-forget action

```ts
save.run({ ... })
```

For sequencing or returned values, use `runPromise` and inspect the returned `Exit`.

## Lower-level

`useDesktopAction(operation, options?)` exposes the lower-level action shape with `concurrency`.

`DesktopActionConcurrency`: `"drop"` (ignore while running), `"replace"` (cancel pending), `"queue"` (serialize).

## Related

- Reference: [Queries](queries.md), [Streams](streams.md)
- Source: [`packages/react/src/mutation.ts`](../../../packages/react/src/mutation.ts)
