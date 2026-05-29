---
title: Streams (React)
description: useDesktopStream for streaming RPC endpoints.
kind: reference
audience: app-developers
effect_version: 4
---

# Streams

Stream hooks subscribe to a `Stream.Stream` source — either an RPC method declared with `stream: true` or any Effect stream you construct yourself. The runtime appends emitted items into a bounded buffer; unmounting cancels the underlying fiber.

## Generated stream endpoints

```tsx
function Importer({ directory }: { directory: string }) {
  const notes = DesktopApp.useDesktop(NotesRpcs)
  const stream = notes.importNotes.useStream({ directory }, { capacity: 64 })

  return (
    <ul>
      {stream.data.map((entry, index) => (
        <li key={index}>{entry.title}</li>
      ))}
    </ul>
  )
}
```

## Shape

```ts
import { Cause, Option } from "effect"

interface StreamState<A, E> {
  readonly status: "idle" | "running" | "closed" | "failure"
  readonly data: readonly A[]
  readonly error: Option.Option<Cause.Cause<E>>
}
```

`data` is a bounded ring of the most recent items, oldest first. `status` becomes `"closed"` when the source terminates cleanly, `"failure"` when it dies; `error` is `Option.some(cause)` only on failure.

## Options

```ts
interface DesktopStreamOptions<A> {
  readonly capacity?: number // bounded buffer; defaults to 1024
  readonly onItem?: (item: A) => void // side effect per emitted item
}
```

`capacity` is normalized by `normalizeDesktopStreamCapacity`; pass `0` to disable trimming, otherwise items beyond the cap are dropped from the head. A non-integer or negative capacity throws a `RangeError`.

## Conditional subscription

For endpoints that accept input, pass `undefined` to mount the hook with an empty payload. Endpoints declared without a payload accept only an options object:

```ts
const stream = notes.importNotes.useStream(enabled ? { directory } : undefined, { capacity: 64 })

// No-payload stream:
const tail = notes.tail.useStream({ capacity: 0, onItem: (line) => console.log(line) })
```

## Cancellation

Unmounting cancels the source fiber via the framework runtime — the RPC client closes the bridge scope and the host releases any resources tied to it.

## Lower-level

- `useDesktopStream(stream, options?, runtime?)` — subscribe to any `Stream.Stream<A, E, R>` with the same `StreamState` semantics. `runtime` defaults to an empty `ManagedRuntime`.
- `useSubscribable(ref)` — subscribe to a `SubscriptionRef<A>` and return the latest value (or `undefined` before the first emission).
- `useEffectResult(effect, deps?, runtime?)` — run an `Effect<A, E, R>` and return `AsyncResult.AsyncResult<A, E>`. `useDisplays` / `useThemeMode` are built on this helper.

## Related

- Reference: [Mutations](mutations.md), [Queries](queries.md)
- Tutorial: [Stream from the runtime](../../tutorials/03-stream-from-the-runtime.md)
- Source: [`packages/react/src/hooks/stream.ts`](../../../packages/react/src/hooks/stream.ts)
