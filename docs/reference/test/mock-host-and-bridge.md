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
  now: () => 1_710_000_000_000
})
```

Records every call. Maintains an in-memory window registry. Preserves trace ids. Implements the full host-protocol surface: `host.version`, `host.ping`, and every `Window.*` method (`create`, `destroy`, `focus`, `show`, `hide`, `getCurrent`, `list`, bounds, attention, title, vibrancy, fullscreen, state).

Fixtures receive `(request, state)` and return either a payload or an `Effect<payload, HostProtocolError>`. Non-JSON payloads fail with `HostProtocolInvalidOutputError`. After running, inspect `host.calls()` (frozen request snapshots) and `host.windows()` (live `WindowCreateInput` map).

## MockBridge

```ts
import { Effect } from "effect"
import { makeMockBridge } from "@orika/test"

const bridge = makeMockBridge({ now: () => 1_710_000_000_000 })

await Effect.runPromise(bridge.succeed("Notes.list", []))
await Effect.runPromise(bridge.fail("Notes.save", { _tag: "WriteFailed" }))
await Effect.runPromise(
  bridge.streamChunks("Notes.import", [
    /* items */
  ])
)
```

Returns a `MockBridgeApi` with:

- `exchange` — a `BridgeClientExchange` you can pass to renderer adapters or `Client(...)`.
- `client(contracts, options?)` — typed client for a record of `BridgeContract` values.
- `succeed`, `fail`, `streamChunks` — queue responses per method; payloads are JSON-validated and reject non-JSON shapes with `HostProtocolInvalidOutputError`.
- `calls()` — frozen call log of `{ method, payload, traceId, timestamp }`.
- `cancels()` — recorded `HostProtocolCancelByRequestEnvelope` values.

A request that has no pinned response fails with `HostProtocolInvalidStateError("missing pinned response")`.

`MockBridgeLive(options?)` exposes the same instance as a `Layer<MockBridge>` when you need it via the service tag.

## Inject into a renderer test

```ts
import { ReactDesktop } from "@orika/react"

const DesktopApp = ReactDesktop.from(Manifest, { transport: bridge.exchange })
```

## Related

- How-to: [Inject a mock host and bridge](../../how-to/inject-mock-host-and-bridge.md), [Write a test with layers](../../how-to/write-a-test-with-layers.md)
- Reference: [`HeadlessRuntime`](headless-runtime.md)
- Source: [`packages/test/src/index.ts`](../../../packages/test/src/index.ts)
