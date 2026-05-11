# Resources

Resources are generation-stamped handles owned by scopes so cleanup is observable and leak tests can fail loudly.

## Runnable Example

```ts run
import { ResourceRegistry, makeResourceRegistry } from "../packages/core/src/index.js"

if (ResourceRegistry === undefined || typeof makeResourceRegistry !== "function") {
  throw new Error("resource registry surface is unavailable")
}
```
