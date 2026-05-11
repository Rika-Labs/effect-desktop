# Signing

Signing keeps platform-specific tool invocation in the CLI and records signed artifact reports.

## Runnable Example

```ts run
import { runDesktopSign } from "../packages/cli/src/index.js"

const command = "desktop sign"
if (typeof runDesktopSign !== "function" || !command.includes("sign")) {
  throw new Error("desktop sign surface is unavailable")
}
```
