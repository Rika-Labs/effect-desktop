# Filesystem

Filesystem primitives authorize requested paths, resolve symlinks safely, and return typed failures for denied or invalid operations.

## Runnable Example

```ts run
import { CliUsageError } from "../packages/cli/src/index.js"

const error = new CliUsageError("docs")
if (error.name !== "CliUsageError") {
  throw new Error("unexpected CLI error name")
}
```
