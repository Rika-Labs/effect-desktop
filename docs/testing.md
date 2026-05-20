---
title: Testing
description: Substitutable layers, mock host and bridge, headless runtime, leak detection.
kind: reference
audience: app-developers
effect_version: 4
---

# Testing

> Full references: [`reference/test/`](reference/test/). Explanation: [`testability`](explanation/testability.md).

ORIKA's test support is built around substitutable layers, mock bridge clients, headless runtime execution, and resource leak detection.

## Public surface

`@orika/test` exports:

- `runHeadless` and `HeadlessRuntime`.
- `MockHost` and `MockBridge`.
- `MemoryFilesystem`.
- `MockProcess` and `MockPTY`.
- `makeMemorySecretsSafeStorage` (memory `SafeStorage`).
- `assertNoOpenResources` and leak detection helpers.
- Native test layers — `WindowTest`, `ScreenTest`, `DialogTest`, `ClipboardTest`.
- Capability law helpers for layer parity.

## Verify Test Exports

```ts run
import { MockBridge, runHeadless } from "../packages/test/src/index.js"

if (MockBridge === undefined || typeof runHeadless !== "function") {
  throw new Error("MockBridge or runHeadless is unavailable")
}
```

## Test rule

Write the test that would have caught the bug. Prefer live path execution, then focused service tests, then type checks.

## Where to go next

- [How-to: write a test with layers](how-to/write-a-test-with-layers.md)
- [How-to: inject a mock host and bridge](how-to/inject-mock-host-and-bridge.md)
- [Testability essay](explanation/testability.md)
- [Test layers reference](reference/test/)
