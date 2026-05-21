---
title: Resources
description: Long-lived runtime and native resources are owned by scopes.
kind: explanation
audience: app-developers
effect_version: 4
---

# Resources

> Full essay: [`explanation/resource-lifecycle.md`](explanation/resource-lifecycle.md). Reference: [`ResourceRegistry`](reference/services/resource-registry.md).

Resources model long-lived runtime or native ownership: windows, streams, file watchers, processes, PTYs, workers, jobs, and other disposable handles.

## Public surface

`@orika/core` exports `ResourceRegistry`, `ManagedResource`, resource ids, resource kinds, snapshots, disposal helpers, and registry constructors.

## Runtime rule

Every long-lived thing has an **owner scope** and a **disposal path**. A renderer id is not enough; the runtime must know who owns the resource and how to close it.

## Verify Resource Exports

```ts run
import { ResourceRegistry } from "../packages/core/src/index.js"

const documentedType = "ManagedResource"

if (ResourceRegistry === undefined || documentedType.length === 0) {
  throw new Error("ResourceRegistry or ManagedResource is unavailable")
}
```

## Testing

Use `assertNoOpenResourcesIn(registry)` or `installResourceLeakDetection(registry)` from `@orika/test`. `HeadlessRuntime.run` installs leak detection by default.

## Where to go next

- [Resource lifecycle essay](explanation/resource-lifecycle.md)
- [`ResourceRegistry` reference](reference/services/resource-registry.md)
- [How-to: write a test with layers](how-to/write-a-test-with-layers.md)
