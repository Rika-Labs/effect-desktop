---
title: Typed APIs
description: RpcGroup contracts are the single source of truth for handlers and clients.
kind: reference
audience: app-developers
effect_version: 4
---

# Typed APIs

> Full references: [`reference/desktop-api.md`](reference/desktop-api.md), [`reference/rpc-surface.md`](reference/rpc-surface.md). How-to: [`define an RPC surface`](how-to/define-an-rpc-surface.md).

ORIKA renderer APIs are Effect RPC contracts. A contract defines method names, input schemas, output schemas, error types, metadata, and support policy in **one place**.

## Contract shape

```ts
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

export class Todo extends Schema.Class<Todo>("Todo")({
  id: Schema.String,
  text: Schema.String
}) {}

export const TodoRpcs = RpcGroup.make(Rpc.make("Todo.list", { success: Schema.Array(Todo) }))
```

Use `RpcGroup.toLayer(...)` to install handlers; use `Desktop.Rpc.surface(...)` for the bundled server, client, test, and docs artifacts.

## Desktop surface

`Desktop.rpc(AppRpc, AppRpc.toLayer(...))` returns a Layer that registers the RPC group + handler pair. Compose multiple registrations with `Desktop.rpcs(...)` and pass the result as `rpcs:` to `Desktop.make`. `Desktop.manifest(App)` exposes the manifest the renderer adapter consumes.

## Verify RPC Exports

```ts run
import { RpcGroup, makeDesktopRpcHandlerRuntime } from "../packages/bridge/src/index.js"

if (RpcGroup === undefined || makeDesktopRpcHandlerRuntime === undefined) {
  throw new Error("RpcGroup or makeDesktopRpcHandlerRuntime is unavailable")
}
```

## Rules

- Schema-decode all boundary inputs.
- Model expected failures as tagged errors.
- Attach capability metadata when a call needs privileged authority.
- Attach support metadata when a method is platform-limited.
- Provide live, client, and test layers for public capabilities.

## Where to go next

- [How-to: define an RPC surface](how-to/define-an-rpc-surface.md)
- [`Desktop.Rpc` reference](reference/rpc-surface.md)
- [Layer-first design](explanation/layer-first-design.md)
- [RPC surface vs. mapped surface](explanation/rpc-surface-vs-mapped.md)
