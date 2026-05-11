# Installation

Install dependencies with Bun and keep the repo on the pinned toolchain before running validation.

## Runnable Example

```ts run
import { runCli } from "../packages/cli/src/index.js"

if (typeof runCli !== "function") {
  throw new Error("desktop --help runner is unavailable")
}
```
