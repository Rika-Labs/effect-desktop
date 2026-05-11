# Storage

Storage covers settings, SQLite, event log, and safe storage boundaries with typed schema validation.

## Runnable Example

```ts run
import { Settings } from "../packages/core/src/index.js"
import { makeMemorySecretsSafeStorage } from "../packages/test/src/index.js"

if (Settings === undefined || typeof makeMemorySecretsSafeStorage !== "function") {
  throw new Error("storage settings or memory secrets surface is unavailable")
}
```
