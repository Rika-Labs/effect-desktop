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

| Method             | Signature                                                                                             | Description                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `register`         | `(input: RegisterResourceInput) => Effect<ManagedResourceHandle, ResourceInvalidArgumentError>`       | Register a new resource and obtain a managed handle.            |
| `get`              | `(id: ResourceId) => Effect<Option<ResourceEntry>>`                                                   | Look up a specific entry.                                       |
| `list`             | `() => Effect<RegistrySnapshot>`                                                                      | Structural snapshot for devtools and tests.                     |
| `dispose`          | `(id: ResourceId) => Effect<void>`                                                                    | Dispose a resource explicitly (idempotent).                     |
| `observe`          | `() => Stream<RegistrySnapshot>`                                                                      | Stream of registry snapshots.                                   |
| `observeLifecycle` | `() => Stream<ResourceLifecycleEvent>`                                                                | Stream of `ResourceRegistered`/`ResourceDisposed`/scope events. |
| `declareScope`     | `(scope, parent?) => Effect<void, ResourceInvalidArgumentError>`                                      | Declare a scope and optional parent linkage.                    |
| `closeScope`       | `(scope) => Effect<void>`                                                                             | Close a scope; disposes its (and descendants') resources.       |
| `share`            | `(handle, targetScope) => Effect<ManagedResourceHandle, ResourceInvalidArgumentError \| StaleHandle>` | Re-key a resource under a different owner scope.                |
| `assertFresh`      | `(handle) => Effect<ResourceEntry, StaleHandle>`                                                      | Validate handle generation before privileged operations.        |
| `close`            | `() => Effect<void>`                                                                                  | Close the registry; release all retained scopes.                |

`RegisterResourceInput` carries `kind`, `ownerScope`, `state`, optional `id`/`reusableId`/`disposalGraceMs`, and an optional `dispose` finalizer. The runtime primitives (`Process`, `PTY`, `Worker`, `Sidecar`, `Filesystem.watch`, window services) call `register` and `assertFresh` on the caller's behalf.

## Layer

`ResourceRegistryLive` is provided by `@orika/core`. It is built with `Effect.acquireRelease` so that closing the layer scope calls `close()` and releases every retained handle.

```ts
import { ResourceRegistry, ResourceRegistryLive, makeResourceRegistry } from "@orika/core"
```

Use `makeResourceRegistry(options?)` only when composing a custom layer (for example, to inject a deterministic `now` or `nextId`).

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
