# Windows

Window operations are typed native-service calls that return Effect values rather than throwing platform errors.

## Runnable Example

```ts run
import { WindowApi, WindowMethodNames } from "../packages/native/src/index.js"

if (WindowApi === undefined || !WindowMethodNames.includes("create")) {
  throw new Error("window API contract is unavailable")
}
```
