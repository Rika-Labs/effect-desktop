# App Config

Application config declares app identity, renderer output, runtime entry, permissions, and release policy.

## Runnable Example

```ts run
import { defineDesktopConfig } from "../packages/config/src/index.js"

const config = defineDesktopConfig({
  files: [],
  security: {}
})

if (config.security === undefined) {
  throw new Error("desktop config helper did not preserve security config")
}
```
