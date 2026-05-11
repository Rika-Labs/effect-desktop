# Concepts

The core concepts are a Rust host, a Bun runtime, typed bridge contracts, Effect services, and scoped resources.

## Runnable Example

```ts run
import { Desktop } from "../packages/core/src/index.js"
import { HostProtocolEnvelope } from "../packages/bridge/src/index.js"

if (typeof Desktop !== "object" || HostProtocolEnvelope === undefined) {
  throw new Error("core desktop or bridge protocol exports are unavailable")
}
```
