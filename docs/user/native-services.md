# Native Services

Native services expose platform capabilities as typed Effect services and preserve unsupported behavior as values.

## Runnable Example

```ts run
import { ClipboardRpcs, DialogRpcs, WindowRpcs } from "../packages/native/src/index.js"

if (ClipboardRpcs === undefined || DialogRpcs === undefined || WindowRpcs === undefined) {
  throw new Error("native service RPC groups are unavailable")
}
```
