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
import { Effect, Layer } from "effect"
import { MockHostLive } from "@orika/test"

const program = Effect.gen(function* () {
  // ... your handler-side effect
})

await Effect.runPromise(
  program.pipe(
    Effect.provide(
      MockHostLive({
        version: { protocol: 1, app: "0.1.0" },
        latencyMs: 10 // simulate host latency
      })
    )
  )
)
```

After running, you can read the recorded calls (`MockHost.calls`) to assert what the handler did.

## MockBridge

`makeMockBridge(options)` returns a `BridgeClientExchange` you can pin responses on. It enforces the contract — wrong-shape pins fail at decode time.

```ts
import { makeMockBridge } from "@orika/test"

const bridge = makeMockBridge({
  pin: [
    { method: "Notes.list", success: [{ id: "1", title: "First" }] },
    { method: "Notes.save", failure: new Error("write failed") },
    {
      method: "Notes.import",
      stream: [
        { kind: "started", total: 2, imported: 0, skipped: 0 },
        { kind: "imported", total: 2, imported: 1, skipped: 0, file: "a.md" },
        { kind: "completed", total: 2, imported: 2, skipped: 0 }
      ]
    }
  ]
})

// Inject into a renderer test
const DesktopApp = ReactDesktop.from(Manifest, { transport: bridge })
```

After running, `bridge.callLog` contains the recorded calls with `{ method, payload, traceId, timestamp }`.

## When to use one vs. the other

| Goal                                       | Use                                              |
| ------------------------------------------ | ------------------------------------------------ |
| Test a handler against a fake host         | `MockHostLive`                                   |
| Test a renderer against fake RPC responses | `makeMockBridge`                                 |
| Test the full handler + bridge round-trip  | `HeadlessRuntime.layer` (bundles both)           |
| Test the bridge framing itself             | Construct envelopes directly via `@orika/bridge` |

## Recording assertions

Both fakes record:

- Call name (method or host primitive).
- Payload (Schema-decoded).
- Trace id (joins to your test's trace).
- Timestamp (monotonic, deterministic in tests).

Assert by reading the log:

```ts
expect(bridge.callLog).toContainEqual(
  expect.objectContaining({ method: "Notes.save", payload: { id: "n1", body: "hello" } })
)
```

## Related

- Reference: [`MockHost`](../reference/test/mock-host-and-bridge.md), test layers
- How-to: [Write a test with layers](write-a-test-with-layers.md)
- Explanation: [Testability](../explanation/testability.md)
