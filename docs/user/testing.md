# Testing

Testing uses the headless harness, mock host, mock bridge, memory filesystem, and leak assertions.

## Runnable Example

```ts run
import { CliUsageError } from "../packages/cli/src/index.js"

const error = new CliUsageError("docs")
if (error.name !== "CliUsageError") {
  throw new Error("unexpected CLI error name")
}
```
