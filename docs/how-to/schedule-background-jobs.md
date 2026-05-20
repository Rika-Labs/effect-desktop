---
title: How to schedule background work
description: Patterns for long-lived cancelable Effect work — workers, sidecars, and Effect.fork.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to schedule background work

ORIKA has three runtime primitives for background work, each with a different shape.

## Pick the right primitive

| Need                                                             | Use                                           |
| ---------------------------------------------------------------- | --------------------------------------------- |
| Separate TypeScript worker runtime with a typed channel          | [`Worker`](spawn-a-worker.md)                 |
| Long-lived companion process you spawn at runtime                | [`Sidecar`](../reference/services/sidecar.md) |
| In-runtime Effect work that needs cancellation but not isolation | `Effect.fork` inside a handler                |

`Worker` is best when you want **capability scoping** — the worker declares what permissions it needs and the registry refuses to spawn one with more than it holds. `Sidecar` is best for long-lived companion processes (language servers, sync daemons). Plain `Effect.fork` is best for everything else.

## Forked Effect inside a handler

```ts
import { Effect, Schedule, Duration } from "effect"

const MyHandlersLive = MyRpcs.toLayer(
  Effect.gen(function* () {
    // Start a background loop scoped to the handler layer
    yield* Effect.fork(
      Effect.gen(function* () {
        yield* doSomeWork()
      }).pipe(Effect.repeat(Schedule.fixed(Duration.minutes(5))), Effect.scoped)
    )

    return {
      /* handlers */
    }
  })
)
```

When the handler layer's scope closes (typically at app shutdown), the fork is interrupted and any acquired resources are released.

## Retry policies

For retry, use Effect's `Schedule` directly:

```ts
import { Schedule, Duration } from "effect"

yield *
  doRiskyThing.pipe(
    Effect.retry(
      Schedule.exponential(Duration.seconds(1)).pipe(
        Schedule.jittered,
        Schedule.compose(Schedule.recurs(5))
      )
    )
  )
```

`Schedule` composes — combine `exponential`, `jittered`, `recurs`, `upTo`, `whileInput` to build the policy you need.

## Worker-style background work

When you want a separate worker runtime with its own resource handle and capability preflight:

```ts
const handle =
  yield *
  worker.spawn({
    script: "workers/indexer.ts",
    inputSchema: InMessage,
    outputSchema: OutMessage,
    capabilities: [{ kind: "filesystem.read", roots: ["/Users/me/Documents"] }]
  })
```

The worker uses the `ResourceOwner` that built the `Worker` service. Build job-specific service layers under `ResourceOwner.job("background-indexer")` when the work should have its own cleanup and audit scope. See [How-to: spawn a worker](spawn-a-worker.md).

## Streaming progress to the renderer

For background work the renderer should observe, expose a streaming RPC method (`stream: true`) and have the renderer subscribe via `useDesktopStream`. Cancellation propagates from renderer unmount through the bridge to the runtime fiber. See [Tutorial 03](../tutorials/03-stream-from-the-runtime.md).

## Related

- Reference: [`Worker`](../reference/services/worker.md), [`Sidecar`](../reference/services/sidecar.md), Effect upstream `Schedule`
- How-to: [Spawn a worker](spawn-a-worker.md), [Run a child process](run-a-child-process.md)
- Tutorial: [Stream from the runtime](../tutorials/03-stream-from-the-runtime.md)
