# Devtools

Devtools read runtime snapshots and streams without owning the production state they display.

## Runnable Example

```ts run
import { DevtoolsShell, DevtoolsSnapshotClient } from "../packages/devtools/src/index.js"

if (DevtoolsShell === undefined || DevtoolsSnapshotClient === undefined) {
  throw new Error("devtools shell or snapshot client is unavailable")
}
```
