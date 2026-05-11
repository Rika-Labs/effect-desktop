# Windows

Window operations are typed native-service calls that return Effect values rather than throwing platform errors.

## Runnable Example

```ts run
import { WindowRpcs, WindowMethodNames } from "../packages/native/src/index.js"

if (WindowRpcs === undefined || !WindowMethodNames.includes("create")) {
  throw new Error("window RPC group is unavailable")
}
```
