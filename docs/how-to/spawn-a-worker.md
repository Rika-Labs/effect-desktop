---
title: How to spawn a worker
description: Run background TypeScript workers with typed channels and capability checks.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to spawn a worker

`Worker` runs background TypeScript in a separate worker runtime. The framework spawns a Bun worker, validates every channel message through Effect Schema, registers the worker as a scoped resource, and checks every declared capability before activation.

## 1. Write the worker script

`workers/indexer.ts`:

```ts
// This file runs in the worker runtime.
self.onmessage = async (event) => {
  const { kind, payload } = event.data
  if (kind === "index") {
    const result = await indexFiles(payload.paths)
    self.postMessage({ kind: "indexed", result })
  }
}
```

Use whatever shape you want for messages — the framework will Schema-validate them per the spawn options.

## 2. Spawn from a handler

```ts
import { Effect, Schema, Stream } from "effect"
import { Worker } from "@orika/core"

const InMessage = Schema.Struct({
  kind: Schema.Literal("index"),
  payload: Schema.Struct({ paths: Schema.Array(Schema.String) })
})
const OutMessage = Schema.Struct({
  kind: Schema.Literal("indexed"),
  result: Schema.Struct({ count: Schema.Number })
})

const program = Effect.gen(function* () {
  const worker = yield* Worker
  const handle = yield* worker.spawn({
    script: "workers/indexer.ts",
    inputSchema: InMessage,
    outputSchema: OutMessage,
    capabilities: [{ kind: "filesystem.read", roots: ["/Users/me/Documents"] }]
  })

  // Send a message
  yield* handle.send({ kind: "index", payload: { paths: ["/Users/me/Documents"] } })

  // Receive
  yield* handle.messages.pipe(
    Stream.runForEach((message) => Effect.log(`indexed ${message.result.count}`))
  )
})
```

What the framework checks before the worker activates:

- Every declared capability must have a matching `PermissionRegistry` declaration. Missing → `CapabilityNotHeld`, no spawn.
- The `inputSchema` is enforced on every `send`. Bad shape → `ChannelError`.
- The `outputSchema` is enforced on every received message.
- The worker is registered with `ResourceRegistry` under the current `ResourceOwner`.

## 3. Cleanup is automatic

When the owning `ResourceOwner` scope closes, the worker is terminated, the per-scope concurrency budget is released, and the resource is unregistered. If the worker crashes, `WorkerCrashed` arrives on the message stream rather than throwing.

## 4. Inspect what's running

```ts
const live = yield * worker.list()
// [{ id, script, ownerScope, resourceId, status, uptimeMs, capabilities, lastError? }, ...]
```

Devtools' workflows panel renders this list live.

## Why workers and not plain `setTimeout`?

Three reasons:

- **Runtime separation.** A worker that hangs or leaks is tracked and terminated as its own resource.
- **Capability discipline.** Workers declare what they need; the registry refuses to spawn one that wants more than it has.
- **Backpressure.** The bridge channels have bounded queues; misbehaving producers can't drown the consumer.

For pure-CPU work that doesn't need its own permission scope, `Effect.fork` inside a handler is fine. For anything you'd want to inspect, terminate, or rate-limit independently, use a worker.

## Related

- Reference: [`Worker`](../reference/services/worker.md), [`PermissionRegistry`](../reference/services/permission-registry.md)
- How-to: [Schedule background jobs](schedule-background-jobs.md), [Run a child process](run-a-child-process.md)
