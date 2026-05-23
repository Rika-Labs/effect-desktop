---
title: How to inject a mock host and bridge
description: Substitute MockHost and MockBridge for fine-grained test control.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to inject a mock host and bridge

`HeadlessRuntime` is convenient but composes the whole test stack. When you need finer control — record specific calls, simulate failures, drive the bridge directly — provide `MockHost` and `MockBridge` yourself.

## MockHost

`MockHostLive(options)` is a fake Rust host. It records every call, maintains an in-memory window registry, preserves trace IDs, and implements `host.version`, `host.ping`, `Window.create`, `Window.destroy`.

```ts
import { Effect, ManagedRuntime } from "effect"
import { WINDOW_CREATE_METHOD, WINDOW_DESTROY_METHOD, makeHostWindowClient } from "@orika/bridge"
import { MockHost, MockHostLive } from "@orika/test"

const runtime = ManagedRuntime.make(MockHostLive())

await runtime.runPromise(
  Effect.gen(function* () {
    const host = yield* MockHost
    const window = makeHostWindowClient(host)
    const created = yield* window.create({ title: "Docs" })
    yield* window.destroy(created.windowId)

    expect(host.calls().map((call) => call.method)).toEqual([
      WINDOW_CREATE_METHOD,
      WINDOW_DESTROY_METHOD
    ])
  })
)
```

Override host behavior with `fixtures` when you need a specific response or typed host failure. After running, read `host.calls()` and `host.windows()` to assert what the handler did.

## MockBridge

`makeMockBridge(options)` returns a mock bridge with an `exchange`, a typed `client(...)` helper, response queues, and a call log. It enforces the contract — wrong-shape queued responses fail at decode time.

```ts
import { Effect } from "effect"
import { makeMockBridge } from "@orika/test"

const bridge = makeMockBridge({ now: () => 1710000000000 })

await Effect.runPromise(bridge.succeed("Notes.list", [{ id: "1", title: "First" }]))
await Effect.runPromise(bridge.fail("Notes.save", { _tag: "WriteFailed" }))
await Effect.runPromise(
  bridge.streamChunks("Notes.import", [
    { kind: "started", total: 2, imported: 0, skipped: 0 },
    { kind: "imported", total: 2, imported: 1, skipped: 0, file: "a.md" },
    { kind: "completed", total: 2, imported: 2, skipped: 0 }
  ])
)

// Inject into a renderer test
const DesktopApp = ReactDesktop.from(Manifest, { transport: bridge.exchange })
```

After running, `bridge.calls()` contains the recorded calls with `{ method, payload, traceId, timestamp }`.

## When to use one vs. the other

| Goal                                       | Use                                              |
| ------------------------------------------ | ------------------------------------------------ |
| Test a handler against a fake host         | `MockHostLive`                                   |
| Test a renderer against fake RPC responses | `makeMockBridge`                                 |
| Test the full handler + bridge round-trip  | `HeadlessRuntime.run` or `HeadlessRuntime.layer` |
| Test the bridge framing itself             | Construct envelopes directly via `@orika/bridge` |

## Recording assertions

Both fakes record:

- Call name (method or host primitive).
- Payload (Schema-decoded).
- Trace id (joins to your test's trace).
- Timestamp (monotonic, deterministic in tests).

Assert by reading the log:

```ts
expect(bridge.calls()).toContainEqual(
  expect.objectContaining({ method: "Notes.save", payload: { id: "n1", body: "hello" } })
)
```

## Related

- Reference: [`MockHost`](../reference/test/mock-host-and-bridge.md), test layers
- How-to: [Write a test with layers](write-a-test-with-layers.md)
- Explanation: [Testability](../explanation/testability.md)
