---
title: How to write a test with layers
description: Use HeadlessRuntime to exercise handlers without a real OS.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to write a test with layers

`@orika/test` provides a headless runtime that composes mock host, mock bridge, memory filesystem, mock process, and mock PTY into one layer. Most handler tests don't need anything more.

## 1. Import

```ts
import { Effect } from "effect"
import { HeadlessRuntime } from "@orika/test"
import { test, expect } from "bun:test"
```

## 2. Run an effect against the headless layer

```ts
test("Notes.save persists and returns a savedAt timestamp", async () => {
  await Effect.runPromise(
    HeadlessRuntime.run(
      Effect.gen(function* () {
        const result = yield* SaveNote({ id: "n1", body: "hello" })
        expect(result.savedAt).toBeGreaterThan(0)
      }).pipe(Effect.provide(NotesHandlersLive)),
      { leakDetection: { testName: "save persists" } }
    )
  )
})
```

`HeadlessRuntime.run`:

- Provides real `PermissionRegistry`, `ResourceRegistry`, `Telemetry`, and `ResourceOwner`.
- Provides mock `MockHost`, `MockBridge`, `MemoryFilesystem`, `MockProcess`, `MockPTY`.
- Installs resource leak detection. The test fails if a handler opens a process, watcher, or worker without closing it.

## 3. Inject native test layers selectively

If you need a specific native service in the test (say, `WindowTest` instead of leaving it undefined):

```ts
import { test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HeadlessRuntime, WindowTest } from "@orika/test"
import { Window } from "@orika/native"

const TestLive = WindowTest().pipe(Layer.provideMerge(HeadlessRuntime.layer()))

test("creates a window", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const window = yield* Window
      const handle = yield* window.create({ title: "Test" })
      expect(handle.id).toBeTruthy()
    }).pipe(Effect.provide(TestLive))
  )
})
```

For multi-surface scenarios, `TestDesktop.layer({ permissions: "allow-all" })` composes `ClipboardTest`, `DialogTest`, `ScreenTest`, `WindowTest`, and a `PermissionRegistry` in one layer; pair it with `TestDesktop.windows` and `TestDesktop.expectNoLeakedResources` for assertions.

## 4. Queue RPC responses on the mock bridge

```ts
import { Effect } from "effect"
import { makeMockBridge } from "@orika/test"

const bridge = makeMockBridge()

await Effect.runPromise(bridge.succeed("Notes.list", []))
await Effect.runPromise(bridge.succeed("Notes.save", { id: "n1", savedAt: 0 }))
```

`succeed` and `fail` validate that the queued payload is JSON-serializable at queue time. Contract-shape validation happens later, when a typed client decodes the queued response on read.

## 5. Assert resource cleanup

```ts
import { Effect } from "effect"
import { ResourceRegistry } from "@orika/core"
import { assertNoOpenResources } from "@orika/test"

Effect.gen(function* () {
  // ...handler effect...
  yield* assertNoOpenResources({ testName: "save persists" })
})
```

`HeadlessRuntime.run` does this automatically. Call `assertNoOpenResources`
directly when you compose a layer manually; pass an already-built
`ResourceRegistryApi` to `assertNoOpenResourcesIn(registry, options)` when you
own the registry outside an Effect.

## 6. Render-side tests with React Testing Library

```tsx
import { test } from "bun:test"
import { Effect } from "effect"
import { render, screen } from "@testing-library/react"
import { ReactDesktop } from "@orika/react"
import { makeUnaryDesktopTransportFromBridgeClientExchange } from "@orika/bridge"
import { makeMockBridge } from "@orika/test"
import { Manifest } from "../src/renderer-manifest.js"

test("renders the greeting", async () => {
  const bridge = makeMockBridge()
  await Effect.runPromise(bridge.succeed("Greeting.say", { message: "Hi, Test!" }))
  const transport = await Effect.runPromise(
    makeUnaryDesktopTransportFromBridgeClientExchange(bridge.exchange)
  )
  const DesktopApp = ReactDesktop.from(Manifest)

  render(DesktopApp.createRoot(<Greeter />, { transport }))
  // ... interact, assert
})
```

The renderer's transport is just another layer; substituting it gives you a deterministic UI test.

## What you don't write

- A mock filesystem (`MemoryFilesystem`).
- A mock process spawner (`MockProcess`, `MockPTY`).
- A mock window manager (`WindowTest`, `TestDesktop`, `MockHost`).
- A mock secret store (`makeMemorySecretsSafeStorage`).

If a faked service you need isn't in `@orika/test`, that's an issue worth filing.

## Related

- Reference: [Test layers](../reference/test/)
- Explanation: [Testability](../explanation/testability.md)
- How-to: [Inject a mock host and bridge](inject-mock-host-and-bridge.md)
