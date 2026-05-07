# Bridge

The bridge owns request, response, stream, cancellation, redaction, and protocol error boundaries.

## Runnable Example

```ts run
import { CliUsageError } from "../packages/cli/src/index.js"

const error = new CliUsageError("docs")
if (error.name !== "CliUsageError") {
  throw new Error("unexpected CLI error name")
}
```
