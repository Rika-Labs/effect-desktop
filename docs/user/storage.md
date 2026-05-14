# Storage

Storage covers settings, SQLite, event log, and safe storage boundaries with typed schema validation.

Workflow execution has two explicit engine layers. `WorkflowEngineMemory` is transient and is
intended for tests and development. `WorkflowEngineDurable` uses Effect's cluster workflow engine
with SQL-backed message and runner storage; workflow messages, activity/deferred replies, timers,
and runner assignment state survive process restart when the provided `SqlClient` points at a
durable SQLite file.

## Runnable Example

```ts run
import { Settings } from "../packages/core/src/index.js"
import { makeMemorySecretsSafeStorage } from "../packages/test/src/index.js"

if (Settings === undefined || typeof makeMemorySecretsSafeStorage !== "function") {
  throw new Error("storage settings or memory secrets surface is unavailable")
}
```
