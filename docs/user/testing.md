# Testing

Testing uses the headless harness, mock host, mock bridge, memory filesystem, and leak assertions.

## Runnable Example

```ts run
import { MockBridge, runHeadless } from "../packages/test/src/index.js"

if (MockBridge === undefined || typeof runHeadless !== "function") {
  throw new Error("headless test runtime helpers are unavailable")
}
```

## Native service test layers

Use native test layers for service-level tests instead of constructing bridge envelopes by hand.

`ScreenTest()`, `ClipboardTest()`, and `DialogTest()` are the current Layer-first proof for native services. The same service program can run against live, bridge-client, and deterministic test providers by swapping layers.

`TestWindow.layer()` follows the supported Window client surface. It records `Window.create` and `Window.close` calls and tracks open handles. Descriptor-only unsupported Window methods are not present on the test client.
