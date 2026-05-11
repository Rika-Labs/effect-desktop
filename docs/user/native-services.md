# Native Services

Native services expose platform capabilities as typed Effect services and preserve unsupported behavior as values.

## Runnable Example

```ts run
import { ClipboardApi, DialogApi, WindowApi } from "../packages/native/src/index.js"

if (ClipboardApi === undefined || DialogApi === undefined || WindowApi === undefined) {
  throw new Error("native service contracts are unavailable")
}
```
