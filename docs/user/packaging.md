# Packaging

Packaging emits the spec artifact set for the host platform and writes metadata for every artifact.

## Runnable Example

```ts run
import { runDesktopPackage } from "../packages/cli/src/index.js"

const command = "desktop package"
if (typeof runDesktopPackage !== "function" || !command.includes("package")) {
  throw new Error("desktop package surface is unavailable")
}
```
