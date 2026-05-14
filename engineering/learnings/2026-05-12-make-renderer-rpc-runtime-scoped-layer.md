---
date: 2026-05-12
type: in-flight-refactor
topic: Make renderer RPC runtime a scoped layer
issue: https://github.com/Rika-Labs/effect-desktop/issues/1281
pr: None
---

# Make Renderer RPC Runtime a Scoped Layer

## Decision

Renderer RPC client construction belongs in scoped Effect layers; framework packages own the synchronous UI bridge with `ManagedRuntime`.

## What changed

Core now exposes `RendererRpcClients`, `RendererRpcTransport`, `makeDesktopRendererRpcClientLayer`, `makeDesktopRendererRpcLayer`, and `makeDesktopRendererRpcTestLayer`. Client construction, protocol acquisition, `RpcClient.make`, and `RpcTest.makeClient` now run inside layer scopes.

React, Vue, and Solid create adapter-local `ManagedRuntime` instances, read the `RendererRpcClients` service once for their framework context, and dispose the managed runtime in their existing cleanup hooks. Global transport lookup moved to those framework edges instead of happening inside core acquisition.

## Why it mattered

The old renderer RPC runtime was a thin custom object over Effect scope and layer semantics. It hid `Scope.makeUnsafe`, `Effect.runSync`, global transport selection, and an imperative `dispose` method inside core. That encouraged future renderer features to keep adding lifecycle policy to a bespoke runtime instead of using the Effect layer graph.

## Example

```ts
const runtime = ManagedRuntime.make(
  makeDesktopRendererRpcLayer(app, {
    framework: "react",
    transport: transport ?? getGlobalDesktopRendererRpcTransport(),
    rpcLayers
  })
)

const clients = runtime.runSync(Effect.service(RendererRpcClients)).clients
```

## Rule candidate

If a core helper exists only to allocate an Effect scope and return `{ service, dispose }`, model it as a scoped layer and let integration packages own any imperative runtime bridge.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it -- `/learn` never auto-edits AGENTS.md.
