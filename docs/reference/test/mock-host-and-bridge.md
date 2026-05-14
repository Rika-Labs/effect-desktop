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
import { MockHostLive, MockHost } from "@effect-desktop/test"

const layer = MockHostLive({
  version: { protocol: 1, app: "0.1.0" },
  latencyMs: 10
})
```

Records every call. Maintains an in-memory window registry. Preserves trace ids. Implements `host.version`, `host.ping`, `Window.create`, `Window.destroy`.

After running, inspect `MockHost.calls` to assert what the handler did.

## MockBridge

```ts
import { makeMockBridge } from "@effect-desktop/test"

const bridge = makeMockBridge({
  pin: [
    { method: "Notes.list", success: [] },
    { method: "Notes.save", failure: new Error("write failed") },
    { method: "Notes.import", stream: [/* items */] }
  ]
})
```

Returns a `BridgeClientExchange` you can pin per-method responses on. Enforces the contract — wrong-shape pins fail at decode time.

`bridge.callLog` contains the recorded calls with `{ method, payload, traceId, timestamp }`.

## Inject into a renderer test

```ts
const DesktopApp = ReactDesktop.from(Manifest, { transport: bridge })
```

## Related

- How-to: [Inject a mock host and bridge](../../how-to/inject-mock-host-and-bridge.md), [Write a test with layers](../../how-to/write-a-test-with-layers.md)
- Reference: [`HeadlessRuntime`](headless-runtime.md)
- Source: [`packages/test/src/mock-host.ts`](../../../packages/test/src/mock-host.ts), [`mock-bridge.ts`](../../../packages/test/src/mock-bridge.ts)
