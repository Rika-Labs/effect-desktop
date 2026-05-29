---
title: RPC surface vs. mapped surface
description: When to expose generated clients directly and when to hide them behind a service.
kind: explanation
audience: app-developers
effect_version: 4
---

# RPC surface vs. mapped surface

Every public capability owns an `RpcGroup`. The framework gives you two shapes for exposing that group to the runtime:

- **Direct surface** — the public service _is_ the generated `DesktopRpcClient<Rpcs>`. Callers see exactly what the contract declares.
- **Mapped surface** — the public service is a hand-written API that wraps the generated client. Callers see the durable desktop API; the generated calls stay hidden.

`Desktop.Rpc.surface(name, group, options)` packages both shapes plus the schema docs, contract-law checks, server layer, and deterministic test client.

## Direct surface

A direct surface omits the `client` mapper, so the public service _is_ the generated `DesktopRpcClient<Rpcs>`. Callers invoke the generated method straight through:

```ts
const client = yield * Notes
const list = yield * client["Notes.List"](undefined)
```

That call is exactly the generated client method. There is no hand-written wrapper between you and the contract. If the contract changes its return type, every caller updates.

Use **direct** when the capability is purely a passthrough — the runtime semantics are fully captured by the contract, and there is nothing the framework adds on top.

No shipping native module uses the direct shape today: every `NativeSurface.make` call site in `packages/native/src` passes a `client:` mapper, so all of them are mapped. The direct shape (no `client` key) appears only in core tests (`packages/core/src/index.test.ts`).

## Mapped surface

`packages/native/src/window.ts` is the worked example. The public service `Window` is a typed API that hides generated RPC calls behind desktop policy:

```ts
export interface WindowApi {
  readonly create: (input?: WindowCreateOptions) => Effect.Effect<WindowHandle, WindowError, never>
  readonly events: () => Stream.Stream<WindowEvent, WindowError, never>
}
```

`Window.create` accepts an optional `WindowCreateOptions` because the service applies sensible defaults when none is given. The bridge adapter also keeps raw host `Window.Event` and `Window.subscribeEvents` wiring inside the module, so callers consume the canonical `Window.events.Event` stream instead of a side contract.

Use **mapped** when the framework owns durable desktop policy on top of the contract — defaults, validation, scope binding, side effects on supporting services. The surface-generated client stays inside the module; application code reads the mapped service.

## Supported group

`Desktop.Rpc.supportedGroup(group)` filters a descriptor group down to the RPCs annotated as supported. Schema docs and descriptors still see every endpoint; the generated `SupportedDesktopRpcClient` only has the callable ones. Use it only when a capability intentionally publishes descriptor entries before they are callable.

## Choosing between them

| Question                                                                | Answer                                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Is the contract literally what callers should see?                      | Direct                                                                  |
| Does the framework add defaults, validation, or auxiliary side effects? | Mapped                                                                  |
| Will some methods be reserved before they are wired?                    | Use `supportedGroup` either way                                         |
| Will the public API need to evolve faster than the wire contract?       | Mapped (the wrapper absorbs change)                                     |
| Do you want one obvious answer?                                         | Mapped, slightly biased — mapping is reversible; direct exposure is not |

## What both shapes give you

Regardless of which shape you pick, `Desktop.Rpc.surface(...)` returns:

- **A server layer** — the runtime side of the contract.
- **A generated client layer** — the bridge-backed renderer client.
- **A deterministic test client layer** — for unit tests of handlers.
- **Schema docs** — JSON-serializable descriptions of every method.
- **Contract-law checks** — verifies the shape conforms to the layer-first contract.

These are values, not magic. You can grep `WindowSurface` in your runtime entry and trace what gets installed through its `serverLayer` and `clientLayer` fields.

## Related

- [Layer-first design](layer-first-design.md)
- [Architecture overview](architecture.md)
- Reference: [`Desktop.Rpc`](../reference/rpc-surface.md)
