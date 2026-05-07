# Native Services

Native services expose platform capabilities as typed Effect services and preserve unsupported behavior as values.

## Runnable Example

```ts run
import { CliUsageError } from "../packages/cli/src/index.js"

const error = new CliUsageError("docs")
if (error.name !== "CliUsageError") {
  throw new Error("unexpected CLI error name")
}
```
