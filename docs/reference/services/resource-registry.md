---
title: ResourceRegistry
description: Bookkeeping for long-lived runtime and native resources.
kind: reference
audience: app-developers
effect_version: 4
---

# `ResourceRegistry`

Bookkeeping for long-lived runtime and native resources — windows, file watchers, processes, PTYs, workers, jobs, streams. Every primitive registers a `ResourceHandle` keyed by `ResourceId` and tied to a `ScopeId`.

## Import

```ts
import {
  ResourceRegistry,
  ResourceRegistryLive,
  makeResourceRegistry,
  type ResourceId,
  type ResourceKind,
  type ResourceState,
  type ResourceHandle,
  type ManagedResourceHandle,
  type ResourceEntry,
  type RegistrySnapshot,
  type ResourceLifecycleEvent,
  ResourceHandleSchema
} from "@orika/core"
```

## API

| Method     | Signature                              | Description                    |
| ---------- | -------------------------------------- | ------------------------------ |
| `register` | `(handle) => Effect<ResourceId>`       | Register a new resource.       |
| `dispose`  | `(id) => Effect<void>`                 | Dispose explicitly.            |
| `list`     | `() => Effect<ResourceEntry[]>`        | Snapshot for devtools.         |
| `observe`  | `() => Stream<ResourceLifecycleEvent>` | Lifecycle event stream.        |
| `snapshot` | `() => Effect<RegistrySnapshot>`       | Structural snapshot for tests. |

## Layer

```ts
import { Layer } from "effect"
import { ResourceRegistry, makeResourceRegistry } from "@orika/core"

const ResourceRegistryLive = Layer.effect(ResourceRegistry)(makeResourceRegistry())
```

## When you call it directly

You usually don't. The runtime primitives (`Process`, `Worker`, `PTY`, `Filesystem.watch`, `Window`) register resources for you. You consume the registry from devtools and tests.

## Test integration

```ts
import { assertNoOpenResourcesIn } from "@orika/test"

const registry = yield * ResourceRegistry
yield * assertNoOpenResourcesIn(registry, { testName: "no leaks" })
```

`HeadlessRuntime.run` installs leak detection automatically.

## Related

- Explanation: [Resource lifecycle](../../explanation/resource-lifecycle.md)
- Reference: [Test layers](../test/)
- Source: [`packages/core/src/runtime/resources.ts`](../../../packages/core/src/runtime/resources.ts)
