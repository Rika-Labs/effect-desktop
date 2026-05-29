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

## `Rpc.surface(tag, group, options)`

Bundles one `RpcGroup` into:

- A **server layer** (`DesktopRpcsLayer`) you pass to `Desktop.make({ rpcs })`.
- A **generated client layer** that binds your `Context.Key` to either the raw `DesktopRpcClient<Rpcs>` (direct surface) or a hand-mapped facade (mapped surface).
- A **deterministic test client layer factory** that wires the same handlers through `RpcServer.makeNoSerialization` + `RpcClient.makeNoSerialization` for unit tests.
- **Schema docs** — `DesktopRpcSchemaDoc` rows describing every endpoint (and any capability facts).
- **Contract-law checks** — `DesktopRpcContractLaw` entries that verify bridge-compatible tags, unique endpoint names, and schema-backed endpoints.

`tag` is the surface namespace. Every RPC tag in the group must start with `${tag}.`.

Direct surface (public service _is_ the generated client):

```ts
import { Context, Effect, Schema } from "effect"
import { Rpc, RpcClient, RpcGroup } from "effect/unstable/rpc"
import { Desktop } from "@orika/core"

const Ping = Rpc.make("Notes.ping", { success: Schema.String })
const NotesRpcs = RpcGroup.make(Ping)

class NotesClient extends Context.Service<
  NotesClient,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof NotesRpcs>>
>()("app/NotesClient") {}

const NotesHandlers = NotesRpcs.toLayer({
  "Notes.ping": () => Effect.succeed("pong")
})

const NotesSurface = Desktop.Rpc.surface("Notes", NotesRpcs, {
  service: NotesClient,
  handlers: NotesHandlers
})
```

Mapped surface (public service is a hand-written facade over the generated client):

```ts
class NotesFacade extends Context.Service<
  NotesFacade,
  { readonly ping: () => Effect.Effect<string> }
>()("app/NotesFacade") {}

const NotesFacadeSurface = Desktop.Rpc.surface("Notes", NotesRpcs, {
  service: NotesFacade,
  handlers: NotesHandlers,
  client: (client) => ({ ping: () => client["Notes.ping"](undefined) })
})
```

The result has the shape:

```ts
interface DesktopRpcSurface<Tag, Group, Rpcs, ServiceId, ServerE, ServerR> {
  readonly _tag: "DesktopRpcSurface"
  readonly tag: Tag
  readonly group: Group
  readonly serverLayer: DesktopRpcsLayer<ServerE, ..., ServerR>
  readonly clientLayer: Layer.Layer<ServiceId, never, RpcClient.Protocol | Rpc.MiddlewareClient<Rpcs>>
  readonly testClientLayer: DesktopRpcTestClientLayerFactory<Rpcs, ServiceId, ServerE, ServerR>
  readonly schemaDocs: readonly DesktopRpcSchemaDoc[]
  readonly contractLaws: readonly DesktopRpcContractLaw[]
}
```

`testClientLayer()` builds a deterministic in-memory client + server pair using the surface's handlers. The factory is overloaded:

- `testClientLayer()` — when handlers need no extra services.
- `testClientLayer(dependencies)` — provide the handlers' `ServerR` requirement as a `Layer`.

`schemaDocs` are JSON-serializable `DesktopRpcSchemaDoc` rows (payload/success/error schemas, capability, support). `contractLaws` is a fixed list — `bridge-compatible-tags`, `unique-endpoint-names`, `schema-backed-endpoints` — each returning `Effect<void, DesktopRpcSurfaceError>`.

Pass `options.capabilityFacts` to publish capability facts that are not callable RPCs. Their `tag` must be in the surface namespace but must not collide with a callable RPC tag.

## `Rpc.supportedGroup(group)`

Filters an `RpcGroup` to the RPCs whose `RpcSupport` annotation is not `unsupported`. Schema docs still describe every endpoint; the resulting group only contains the callable ones.

```ts
const supported = Desktop.Rpc.supportedGroup(WindowRpcs)
// supported.requests only contains the supported RPCs
```

## `DesktopRpcClient<Rpcs>`

Alias for `RpcClient.RpcClient<Rpcs, RpcClientError.RpcClientError>`. Each method is `(input) => Effect.Effect<output, error | RpcClientError, never>` (or `Stream` for streaming endpoints).

## `SupportedDesktopRpcClient<Rpcs>`

`DesktopRpcClient<Rpcs>` filtered through `SupportedRpc<Rpcs>` — only methods whose `RpcSupport` status is not `unsupported`.

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
