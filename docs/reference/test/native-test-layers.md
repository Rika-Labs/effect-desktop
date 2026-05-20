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
  TestWindow,
  ScreenTest,
  DialogTest,
  ClipboardTest,
  makeTestWindowClient,
  makeMemorySecretsSafeStorage
} from "@orika/test"
```

## Available layers

- `TestWindow.layer()` — fake window manager. Records create/close calls.
- `ScreenTest(options)` — configurable display layout.
- `DialogTest(options)` — pinned dialog responses.
- `ClipboardTest()` — in-memory clipboard.
- `makeTestWindowClient()` — client-only variant for renderer tests.
- `makeMemorySecretsSafeStorage(options)` — in-memory `SafeStorage` for `Secrets`.

## Why each module is run three ways in CI

Each `packages/native/src/<name>.test.ts` runs against:

1. Direct client + live service.
2. Live service through the bridge protocol.
3. Test layer.

If the test layer drifts from the live contract, CI catches it. This is what keeps the test layers honest.

## Related

- Explanation: [Testability](../../explanation/testability.md)
- How-to: [Write a test with layers](../../how-to/write-a-test-with-layers.md)
- Source: [`packages/test/src/`](../../../packages/test/src/)
