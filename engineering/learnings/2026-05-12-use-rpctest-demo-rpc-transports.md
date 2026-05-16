---
date: 2026-05-12
type: in-flight-refactor
topic: Use RpcTest for demo RPC transports
issue: https://github.com/Rika-Labs/effect-desktop/issues/1166
pr: None
---

# Use RpcTest for Demo RPC Transports

## Decision

When a test or demo needs Effect RPC semantics, it should use `RpcTest` through owned renderer RPC layers instead of a local queue/fiber transport.

## What changed

The original plan was to remove fake in-memory host transports from the Notes browser examples and adapter tests. The shipped shape is slightly tighter: framework roots accept `rpcLayers`, core converts those layers to scoped renderer clients with `RpcTest.makeClient`, and the root owns disposal through the same runtime cleanup path as host transports.

The Notes example now shares one `NotesRpcsLive` handler layer and exports `makeNotesDemoRpcLayers()` for browser demos. The host app and browser demos both use the same handler source of truth.

## Why it mattered

The fake transports had reimplemented Effect RPC behavior with local queues, fiber maps, response envelopes, stream envelopes, and cancellation. That made framework tests exercise a parallel protocol simulator instead of the real Effect RPC primitive. Keeping the test path at the renderer runtime boundary let React, Vue, Solid, Next, Astro, and the shared Notes example all stop emulating host envelopes.

## Example

```ts
const workspace = await Effect.runPromise(
  Effect.scoped(
    Effect.service(RendererRpcClients).pipe(
      Effect.flatMap((clients) => clients.clients.get(NotesRpcs)!["Notes.Load"]({})),
      Effect.provide(makeDesktopRendererRpcTestLayer(makeNotesDemoRpcLayers()))
    )
  )
)
```

## Rule candidate

When non-protocol tests need generated RPC clients, use `RpcTest` and keep bridge envelope fixtures only for protocol translation tests.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it -- `/learn` never auto-edits AGENTS.md.
