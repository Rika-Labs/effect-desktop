# Processes

Process primitives validate permissions, stream output with backpressure, and terminate process trees on scope close.

## Runnable Example

```ts run
import { Process } from "../packages/core/src/index.js"
import { MockProcess } from "../packages/test/src/index.js"

if (Process === undefined || MockProcess === undefined) {
  throw new Error("process runtime or test double is unavailable")
}
```
