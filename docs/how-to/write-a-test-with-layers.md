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
import { Layer } from "effect"
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

## 4. Pin RPC responses on the mock bridge

```ts
import { Effect } from "effect"
import { makeMockBridge } from "@orika/test"

const bridge = makeMockBridge()

await Effect.runPromise(bridge.succeed("Notes.list", []))
await Effect.runPromise(bridge.succeed("Notes.save", { id: "n1", savedAt: 0 }))
```

The bridge enforces the contract — queueing a response with the wrong shape fails at decode time, just like production.

## 5. Assert resource cleanup

```ts
import { ResourceRegistry } from "@orika/core"
import { assertNoOpenResourcesIn } from "@orika/test"

const registry = yield * ResourceRegistry
yield * assertNoOpenResourcesIn(registry, { testName: "save persists" })
```

`HeadlessRuntime.run` does this automatically. Call `assertNoOpenResourcesIn`
directly when you run a manually composed layer through `Effect.runPromise`.

## 6. Render-side tests with React Testing Library

```tsx
import { Effect } from "effect"
import { render, screen } from "@testing-library/react"
import { ReactDesktop } from "@orika/react"
import { makeMockBridge } from "@orika/test"
import { Manifest } from "../src/manifest.js"

test("renders the greeting", async () => {
  const bridge = makeMockBridge()
  await Effect.runPromise(bridge.succeed("Greeting.say", { message: "Hi, Test!" }))
  const DesktopApp = ReactDesktop.from(Manifest, { transport: bridge.exchange })

  render(
    <DesktopApp.createRoot>
      <Greeter />
    </DesktopApp.createRoot>
  )
  // ... interact, assert
})
```

The renderer's transport is just another layer; substituting it gives you a deterministic UI test.

## What you don't write

- A mock filesystem (`MemoryFilesystem`).
- A mock process spawner (`MockProcess`).
- A mock window manager (`TestWindow`, `MockHost`).
- A mock approval queue (test layer for `ApprovalBroker`).

If a faked service you need isn't in `@orika/test`, that's an issue worth filing.

## Related

- Reference: [Test layers](../reference/test/)
- Explanation: [Testability](../explanation/testability.md)
- How-to: [Inject a mock host and bridge](inject-mock-host-and-bridge.md)
