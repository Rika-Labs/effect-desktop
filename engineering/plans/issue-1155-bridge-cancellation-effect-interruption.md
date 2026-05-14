# Issue #1155: Move Bridge Cancellation To Effect Interruption

## Problem

Bridge client cancellation is currently modeled as a bridge-specific call option:

```ts
client.project.open(input, { signal })
```

That forces core bridge code to race `exchange.request(...)` against an `AbortSignal`
callback and to install a separate abort listener for streams. This duplicates Effect's
own interruption model and makes cancellation behavior depend on a custom renderer DSL.

## Target Architecture

Use Effect interruption as the cancellation substrate.

Unary requests should attach protocol cancel emission to interruption:

```ts
exchange
  .request(request)
  .pipe(Effect.onInterrupt(() => sendCancelByRequest(exchange, request, now)))
```

Streams should keep terminal-frame tracking, but finalization should run the cancel
Effect directly when the consumer ends before a terminal frame:

```ts
Stream.ensuring(terminal ? Effect.void : sendCancelByRequest(exchange, request, now))
```

Browser `AbortSignal` integration belongs at Effect runtime edges, such as
`Effect.runPromise(effect, { signal })` or interrupting a running fiber. Bridge client
methods should not expose a parallel cancellation option.

## Modules

| Module                                                | Change                                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/bridge/src/client.ts`                       | Remove `BridgeClientCallOptions`, remove abort listener helpers, send protocol cancel from `Effect.onInterrupt` and stream finalizers. |
| `packages/bridge/src/client.test.ts`                  | Replace abort-signal tests with Effect fiber interruption tests.                                                                       |
| `packages/bridge/src/streams.test.ts`                 | Replace stream abort-signal tests with stream fiber interruption tests.                                                                |
| `api/snapshots/@effect-desktop__bridge.snapshot.json` | Update the public bridge API after removing method call options.                                                                       |
| `engineering/roadmap/layer-first-issue-order.md`      | Record #1155 completion after validation.                                                                                              |

## Verification

- Interrupting a unary bridge call sends exactly one cancel envelope and lets the host
  transition to canceled.
- Interrupting a never-answering unary exchange releases the caller promptly.
- Cancel envelope construction/send failure during interruption does not mask the
  caller's interruption.
- Interrupting a stream consumer sends cancel and releases the producer.
- Normal stream terminal frames do not send a late cancel.

## Architecture-Debt Sweep

Remove these custom wrappers in this issue:

- `BridgeClientCallOptions.signal`
- `runRequestWithCancellation`
- `failIfAlreadyAborted`
- `installAbortCancellation`

`BridgeClientExchange.cancel` remains because it owns durable bridge protocol translation:
it maps Effect interruption onto the cancel envelope understood by the host.
Its implementations must stay bounded and interruption-friendly because renderer cleanup
starts cancel dispatch best-effort in the background.
