---
title: Native test layers
description: Per-module test doubles for clipboard, dialog, screen, window, and the rest.
kind: reference
audience: app-developers
effect_version: 4
---

# Native test layers

Each native module ships a deterministic test layer. They satisfy the same contract as the live versions and run entirely in memory.

## Import

```ts
import {
  ClipboardTest,
  ClipboardClientTest,
  DialogTest,
  DialogClientTest,
  ScreenTest,
  TestDesktop,
  WindowTest,
  makeMemorySecretsSafeStorage
} from "@orika/test"
```

## Available layers

- `ClipboardTest(options?)` — `Layer.Layer<Clipboard>`. Seeds `text`/`html`, configurable per-capability `supported` flags.
- `DialogTest(options?)` — `Layer.Layer<Dialog>`. Pins `openFilePaths`, `openDirectoryPaths`, `saveFilePath`, `confirmResult`.
- `ScreenTest(options?)` — `Layer.Layer<Screen>`. Scripted display layout via `displays`.
- `WindowTest()` — `Layer.Layer<Window | TestWindowState, never, ResourceRegistry>`. Records create/close through the real `ResourceRegistry` so leaked windows surface as `ResourceLeakError`. Inspect via the `TestWindowState` service.
- `ClipboardClientTest(options?)` — `Layer.Layer<ClipboardClient>`. Renderer-side variant wired through the test service.
- `DialogClientTest(options?)` — `Layer.Layer<DialogClient>`. Renderer-side variant wired through the test service.
- `makeMemorySecretsSafeStorage(options?)` — in-memory `SafeStorage` implementation for `Secrets`.

## `TestDesktop`

Composes the native test layers (Clipboard, Dialog, Screen, Window) with a `PermissionRegistry` configured by policy. Useful when a handler touches several native surfaces.

```ts
import { Effect, Layer, ManagedRuntime } from "effect"
import { Window } from "@orika/native"
import { TestDesktop } from "@orika/test"

const runtime = ManagedRuntime.make(TestDesktop.layer({ permissions: "allow-all" }))

await runtime.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.create({ title: "Notes" })
      const opened = yield* TestDesktop.windows
      yield* TestDesktop.expectNoLeakedResources
      return opened
    })
  )
)
```

- `TestDesktop.layer(options?)` — `permissions: "allow-all" | "deny-all"` plus per-surface options.
- `TestDesktop.windows` — `Effect.Effect<readonly TestWindowRecord[]>` reading the `TestWindowState`.
- `TestDesktop.expectNoLeakedResources` — fails with `ResourceLeakError` when handles remain open.

## Why each module is run three ways in CI

Each `packages/native/src/<name>.test.ts` runs against:

1. Direct service layer.
2. Bridge client layer.
3. Test layer.

If the test layer drifts from the live contract, CI catches it. This is what keeps the test layers honest.

## Capability law helpers

`@orika/test` exports `CapabilityLaws`, `LayerMatrix`, and `FailureAssertions` to drive the three-layer parity tests.

```ts
import { CapabilityLaws } from "@orika/test"
import { Clipboard } from "@orika/native"

const suite = CapabilityLaws.make("Clipboard", Clipboard, {
  "round trips text": (clipboard) =>
    Effect.gen(function* () {
      yield* clipboard.writeText("shared")
      expect(yield* clipboard.readText()).toBe("shared")
    })
})

CapabilityLaws.run(suite, [
  { name: "test layer", layer: ClipboardTest() },
  { name: "bridge client layer", layer: (law) => makeBridgeLayer(law.name) }
])
```

## Related

- Explanation: [Testability](../../explanation/testability.md)
- How-to: [Write a test with layers](../../how-to/write-a-test-with-layers.md)
- Source: [`packages/test/src/native.ts`](../../../packages/test/src/native.ts), [`packages/test/src/capability-laws.ts`](../../../packages/test/src/capability-laws.ts)
