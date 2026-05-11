# Filesystem

Filesystem primitives authorize requested paths, resolve symlinks safely, and return typed failures for denied or invalid operations.

## Runnable Example

```ts run
import { Filesystem } from "../packages/core/src/index.js"
import { MemoryFilesystem } from "../packages/test/src/index.js"

if (Filesystem === undefined || MemoryFilesystem === undefined) {
  throw new Error("filesystem runtime or memory test adapter is unavailable")
}
```
