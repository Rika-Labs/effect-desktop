# Migration Within Pre-1.0 APIs

Before v1.0, migration notes explain API movement and point users at the current public package surface.

## Runnable Example

```ts run
import { runSemverGuard } from "../packages/cli/src/index.js"

const migrationPolicy = "bridgeEnvelopePolicy"
if (typeof runSemverGuard !== "function" || migrationPolicy.length === 0) {
  throw new Error("pre-1 migration semver guard is unavailable")
}
```
