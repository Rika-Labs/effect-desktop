---
title: Sidecar
description: Long-lived companion processes managed alongside the runtime.
kind: reference
audience: app-developers
effect_version: 4
---

# `Sidecar`

Spawns and supervises long-lived companion processes — language servers, sync daemons, build watchers — that should outlive a single request.

## Import

```ts
import { Sidecar, type SidecarApi, type SidecarHandle } from "@orika/core"
```

## API

| Method  | Signature                               |
| ------- | --------------------------------------- |
| `spawn` | `(input) => Effect<SidecarHandle>`      |
| `wait`  | `(handle) => Effect<ProcessExitStatus>` |
| `list`  | `() => Effect<SidecarSnapshot[]>`       |

`Sidecar.spawn` shares much of `Process.spawn`'s shape but registers a longer-lived resource and applies sidecar-specific restart policies.

## Permissions

Same `process.spawn` capability as `Process`.

## Related

- Reference: [`Process`](process.md), [`Worker`](worker.md)
- Source: [`packages/core/src/runtime/sidecar.ts`](../../../packages/core/src/runtime/sidecar.ts)
