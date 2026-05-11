# Updating

Updating uses signed manifests, channel policy, staged installs, and rollback metadata.

## Runnable Example

```ts run
import { runDesktopPublish } from "../packages/cli/src/index.js"
import type { UpdateManifest } from "../packages/cli/src/index.js"

const manifest = undefined as UpdateManifest | undefined
if (typeof runDesktopPublish !== "function" || manifest !== undefined) {
  throw new Error("update publish surface is unavailable")
}
```
