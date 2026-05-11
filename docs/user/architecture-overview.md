# Architecture Overview

Effect Desktop keeps renderer code unprivileged while the runtime and host communicate through typed protocol envelopes.

## Runnable Example

```ts run
import { HostProtocolRequestEnvelope } from "../packages/bridge/src/index.js"
import { Desktop } from "../packages/core/src/index.js"

if (HostProtocolRequestEnvelope === undefined || typeof Desktop !== "object") {
  throw new Error("desktop protocol architecture exports are unavailable")
}
```
