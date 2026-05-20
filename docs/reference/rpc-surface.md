---
title: Desktop.Rpc surfaces
description: Package an RpcGroup into server, client, test, and docs artifacts.
kind: reference
audience: app-developers
effect_version: 4
---

# `Desktop.Rpc` surfaces

`Desktop.Rpc` is the namespace for packaging an Effect `RpcGroup` into the layer-first artifacts a desktop capability needs.

## Import

```ts
import { Desktop } from "@orika/core"
const Rpc = Desktop.Rpc
```

## `Rpc.surface(name, group, options)`

Bundles one `RpcGroup` into:

- A **server layer** — the runtime side of the contract.
- A **generated client layer** — bridge-backed renderer client.
- A **deterministic test client layer** — for unit tests.
- **Schema docs** — JSON-serializable description of every method.
- **Contract-law checks** — verifies the shape conforms to the layer-first contract.

```ts
const WindowSurface = Desktop.Rpc.surface("Window", WindowRpcGroup, {
  // optional: capability metadata, support metadata, custom client mapping
})
```

The result has the shape:

```ts
interface DesktopSurface<Rpcs> {
  readonly name: string
  readonly group: RpcGroup<Rpcs>
  readonly serverLayer: Layer.Layer<...>
  readonly clientLayer: Layer.Layer<...>
  readonly testClientLayer: Layer.Layer<...>
  readonly schemaDocs: ReadonlyArray<SchemaDoc>
  readonly contractLaws: ReadonlyArray<ContractLaw>
}
```

## `Rpc.supportedGroup(group)`

Filters a descriptor `RpcGroup` to only the RPCs annotated as supported. Schema docs and descriptors still see every endpoint; the generated `SupportedDesktopRpcClient<Rpcs>` only contains the callable ones.

```ts
const supported = Desktop.Rpc.supportedGroup(WindowRpcs)
// supported.toClient() only has create/close
```

## `DesktopRpcClient<Rpcs>`

The generated client type for an RPC group. Each method is `(input) => Effect.Effect<output, error>`.

## `SupportedDesktopRpcClient<Rpcs>`

The filtered version — only methods marked supported.

## When to use surface

- Building a public capability that needs server, client, test, and docs in one place.
- Wiring custom RPC groups into your app where the discipline pays off.

For one-off internal RPCs, `RpcGroup.toLayer(handlers)` directly is fine.

## Direct vs. mapped surface

The two shapes for exposing the surface to your app:

| Shape      | Description                                              | Example  |
| ---------- | -------------------------------------------------------- | -------- |
| **Direct** | Public service _is_ the generated client                 | `Screen` |
| **Mapped** | Public service is a hand-written API wrapping the client | `Window` |

See the explanation page: [RPC surface vs. mapped](../explanation/rpc-surface-vs-mapped.md).

## Related

- [`Desktop` API](desktop-api.md)
- Explanation: [Layer-first design](../explanation/layer-first-design.md), [RPC surface vs. mapped](../explanation/rpc-surface-vs-mapped.md)
- Source: [`packages/core/src/runtime/desktop-rpc-surface.ts`](../../packages/core/src/runtime/desktop-rpc-surface.ts)
