# Commands

Commands validate input, enforce permission, record invocation state, and report handler failures as typed values.

## Runnable Example

```ts run
import { CommandRegistry } from "../packages/core/src/index.js"
import { CommandsDevtools } from "../packages/devtools/src/index.js"

if (CommandRegistry === undefined || CommandsDevtools === undefined) {
  throw new Error("command registry or command devtools surface is unavailable")
}
```
