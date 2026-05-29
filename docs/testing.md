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

`@orika/test` exports (from the package root and `./bridge`, `./core`, `./native`, `./renderer` subpaths):

- `HeadlessRuntime` (`.layer`, `.run`), `runHeadless`.
- `MockHost`, `MockHostLive`, `makeMockHost`.
- `MockBridge`, `MockBridgeLive`, `makeMockBridge`.
- `MemoryFilesystem.layer`, `MemoryFilesystemLive`, `makeMemoryFilesystem`.
- `MockProcess.layer` / `MockProcessLive`, `makeMockProcess`.
- `MockPTY.layer` / `MockPtyLayer`, `makeMockPty`.
- `makeMemorySecretsSafeStorage` (memory `SafeStorage`).
- `assertNoOpenResources`, `assertNoOpenResourcesIn`, `installResourceLeakDetection`, `ResourceLeakError`, `registerLeakMatchers`, `formatLeakedHandleReport`, `leakedHandles`.
- Native test layers — `ClipboardTest`, `ClipboardClientTest`, `DialogTest`, `DialogClientTest`, `ScreenTest`, `WindowTest`, `TestDesktop` (`layer`, `windows`, `expectNoLeakedResources`), `TestPermissionRegistry`.
- Capability law helpers — `CapabilityLaws`, `LayerMatrix`, `FailureAssertions`.

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
