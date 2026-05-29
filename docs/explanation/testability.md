---
title: Testability
description: Substitutable layers, deterministic clients, and the headless runtime — how the framework stays testable.
kind: explanation
audience: app-developers
effect_version: 4
---

# Testability

A framework that is hard to test produces apps that are hard to test. ORIKA's design treats testability as a property of the public surface, not a CI-time afterthought.

## Three properties that make tests easy

- **Every service is a tag.** `Window`, `Filesystem`, `Process`, `Settings`, `Secrets` — all are `Context.Service` tags. Tests provide a different layer for the same tag.
- **Every native module ships a test layer.** `WindowTest`, `ScreenTest`, `DialogTest`, `ClipboardTest` (plus their client-side variants and the composed `TestDesktop`). They satisfy the same contract as the live versions, run entirely in memory, and record what was called.
- **The bridge is substitutable.** `makeMockBridge(options)` returns a mock bridge with an `exchange`, typed `client(...)` helper, response queues, and call log. It enforces the contract — calls with wrong shapes fail at decode time, just like production.

Together, these turn most desktop tests into ordinary unit tests. No real OS, no real window manager, no real notarization — and yet the test exercises the actual runtime path your handlers take.

## The headless runtime

`@orika/test` exports `HeadlessRuntime`, which composes the most common test layers into one:

```ts
import { Effect } from "effect"
import { HeadlessRuntime } from "@orika/test"

await Effect.runPromise(
  HeadlessRuntime.run(
    Effect.gen(function* () {
      // your handler-side effect gets a real permission registry, resource
      // registry, telemetry service, mock bridge, memory filesystem,
      // mock process, mock PTY, and mock host.
    }),
    { leakDetection: { testName: "creates a window" } }
  )
)
```

`HeadlessRuntime.layer(options)` returns the layer if you want to compose it manually. It includes:

- `MockHost` — fake Rust host that records calls and maintains an in-memory window registry.
- `MockBridge` — fake bridge exchange with contract-aware fakes.
- `MemoryFilesystem` — in-memory tree with full permission enforcement.
- `MockProcess`, `MockPTY` — deterministic spawning and output buffering.
- A real `PermissionRegistry`, `ResourceRegistry`, `Telemetry`, and `ResourceOwner`.

The point: **production code paths run unchanged**. The handler doesn't know it's in a test. The same permission checks fire, the same resource registry tracks handles, and telemetry logs are available when your code writes them. The only thing different is the leaves of the dependency graph.

## Resource leak detection

`HeadlessRuntime.run` runs `installResourceLeakDetection(registry)` by default. If your handler opens a process, watcher, or worker without closing it, the test fails with a `ResourceLeakError` that names the resource id and kind. You don't have to write this assertion — you have to opt out.

You can also call `assertNoOpenResourcesIn(registry, options)` directly in tests that don't use `HeadlessRuntime.run`.

## Native test layers as proofs

Each native module (`packages/native/src/<name>.ts`) has a corresponding test layer. `CapabilityLaws.run(suite, layers)` from `@orika/test` runs the same law set against multiple layers — typically:

1. The test layer (e.g. `ClipboardTest()`) — proves the deterministic in-memory implementation matches the contract.
2. The bridge client layer (`Surface.bridgeClientLayer(bridge.exchange)`) — proves the bridge wiring decodes and encodes the same shapes.
3. The live service layer where the host is available.

If you change live behavior without updating the test layer, one of those proofs fails. This keeps `MemoryFilesystem`, `ClipboardTest`, and friends honest — they cannot drift from the live contract without breaking CI.

## What you write in your own tests

A typical handler test:

```ts
import { test, expect } from "bun:test"
import { Effect } from "effect"
import { HeadlessRuntime } from "@orika/test"
import { MyAppHandlersLive } from "../src/handlers.js"
import { SaveNote } from "../src/contracts.js"

test("Notes.save persists and returns a savedAt timestamp", async () => {
  await Effect.runPromise(
    HeadlessRuntime.run(
      Effect.gen(function* () {
        const result = yield* SaveNote({ id: "n1", body: "hello" })
        expect(result.savedAt).toBeGreaterThan(0)
      }).pipe(Effect.provide(MyAppHandlersLive)),
      { leakDetection: { testName: "save persists" } }
    )
  )
})
```

A renderer test (with React Testing Library):

```tsx
import { test, expect } from "bun:test"
import { Effect } from "effect"
import { render, screen, fireEvent } from "@testing-library/react"
import { ReactDesktop } from "@orika/react"
import { makeMockBridge } from "@orika/test"
import { Manifest } from "../src/renderer-manifest.js"

test("renders the greeting", async () => {
  const bridge = makeMockBridge()
  await Effect.runPromise(bridge.succeed("Greeting.say", { message: "Hi, Test!" }))
  const DesktopApp = ReactDesktop.from(Manifest, { transport: bridge.exchange })

  render(
    <DesktopApp.createRoot>
      <Greeter />
    </DesktopApp.createRoot>
  )
  fireEvent.click(screen.getByText("Greet"))
  expect(await screen.findByText("Hi, Test!")).toBeInTheDocument()
})
```

## What you don't have to fake

Because the framework provides faked versions, you don't write:

- A mock window manager.
- A mock filesystem.
- A mock process spawner.
- A mock secret store.
- A mock approval prompt.

If you find yourself writing one, look first at `@orika/test`'s exports. If the framework doesn't provide one for the shape you need, that is a missing piece worth filing as an issue.

## Related

- Reference: [Test layers](../reference/test/) — every test export
- How-to: [Write a test with layers](../how-to/write-a-test-with-layers.md), [Inject a mock host and bridge](../how-to/inject-mock-host-and-bridge.md)
