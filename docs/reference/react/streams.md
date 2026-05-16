---
title: Streams (React)
description: useDesktopStream for streaming RPC endpoints.
kind: reference
audience: app-developers
effect_version: 4
---

# Streams

`useDesktopStream` subscribes to an RPC method declared with `stream: true`. The bridge handles framing and backpressure; the renderer gets typed updates.

## Import

```ts
const stream = DesktopApp.useDesktop(NotesRpcs).import.useStream(input, options)
```

## Shape

```ts
interface StreamState<A, E> {
  readonly status: "pending" | "loading" | "error" | "success"
  readonly value?: A // last emitted item
  readonly error?: E
}
```

## Options

```ts
{
  capacity?: number             // buffered items (default 32)
  onItem?: (item: A) => void    // side-effect per item
}
```

## Conditional subscription

Pass `undefined` as input to pause; reactivating with new input restarts the subscription.

```ts
const stream = useStream(enabled ? { directory } : undefined, { capacity: 64 })
```

## Cancellation

Unmounting the subscription cancels the underlying Effect — the runtime sends `HostProtocolCancelByRequestEnvelope` and closes the source scope.

## Lower-level

- `useSubscribable(subscribable, options?)` — subscribe to an arbitrary Effect Subscribable.
- `useEffectResult(result)` — wrap an Effect result as a `StreamState`.

## Related

- Reference: [Mutations](mutations.md), [Queries](queries.md)
- Tutorial: [Stream from the runtime](../../tutorials/03-stream-from-the-runtime.md)
- Source: [`packages/react/src/hooks/stream.ts`](../../../packages/react/src/hooks/stream.ts)
