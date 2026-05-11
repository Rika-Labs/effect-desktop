# Testing

Testing uses the headless harness, mock host, mock bridge, memory filesystem, and leak assertions.

## Runnable Example

```ts run
import { MockBridge, runHeadless } from "../packages/test/src/index.js"

if (MockBridge === undefined || typeof runHeadless !== "function") {
  throw new Error("headless test runtime helpers are unavailable")
}
```
