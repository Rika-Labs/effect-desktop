---
title: MockHost and MockBridge
description: Substitute the Rust host and bridge exchange for fine-grained test control.
kind: reference
audience: app-developers
effect_version: 4
---

# `MockHost` and `MockBridge`

Two fakes. `MockHost` replaces the Rust host. `MockBridge` replaces the bridge exchange used by renderer-side tests.

## MockHost

```ts
import { MockHostLive } from "@orika/test"

const layer = MockHostLive({
  fixtures: {
    "host.ping": () => undefined
  },
  now: () => 1710000000000
})
```

Records every call. Maintains an in-memory window registry. Preserves trace ids. Implements `host.version`, `host.ping`, `Window.create`, `Window.destroy`.

After running, inspect `host.calls()` and `host.windows()` from the `MockHost` service to assert what the handler did.

## MockBridge

```ts
import { Effect } from "effect"
import { makeMockBridge } from "@orika/test"

const bridge = makeMockBridge({ now: () => 1710000000000 })

await Effect.runPromise(bridge.succeed("Notes.list", []))
await Effect.runPromise(bridge.fail("Notes.save", { _tag: "WriteFailed" }))
await Effect.runPromise(
  bridge.streamChunks("Notes.import", [
    /* items */
  ])
)
```

Returns a mock bridge with an `exchange`, a typed `client(...)` helper, queued success/failure/stream responses, and a call log. Enforces the contract — wrong-shape queued responses fail at decode time.

`bridge.calls()` contains the recorded calls with `{ method, payload, traceId, timestamp }`.

## Inject into a renderer test

```ts
const DesktopApp = ReactDesktop.from(Manifest, { transport: bridge.exchange })
```

## Related

- How-to: [Inject a mock host and bridge](../../how-to/inject-mock-host-and-bridge.md), [Write a test with layers](../../how-to/write-a-test-with-layers.md)
- Reference: [`HeadlessRuntime`](headless-runtime.md)
- Source: [`packages/test/src/index.ts`](../../../packages/test/src/index.ts)
