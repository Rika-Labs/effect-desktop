# PTYs

PTY primitives expose terminal I/O through typed Effect services with explicit resize, write, kill, and exit handling.

## Runnable Example

```ts run
import { PTY } from "../packages/core/src/index.js"
import { MockPTY } from "../packages/test/src/index.js"

if (PTY === undefined || MockPTY === undefined) {
  throw new Error("PTY runtime or test double is unavailable")
}
```
