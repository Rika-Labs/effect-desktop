---
date: 2026-05-16
type: in-flight-refactor
topic: Consolidate event-aware native bridge client layers
issue: https://github.com/Rika-Labs/effect-desktop/issues/1393
pr: none
---

# Consolidate event-aware native bridge client layers

## Decision

Event-aware bridge client construction belongs in `NativeSurface`, but service modules must pass deferred bridge client factories so module initialization order stays explicit and safe.

## What changed

The issue asked for the repeated per-service bridge protocol layer helpers to move into `NativeSurface` or a shared helper. The shipped version adds `bridgeClient` to `NativeSurface.make`, builds the bridge protocol-backed `RpcClient` once in `NativeSurface.bridgeClientLayer`, and migrates the native event surfaces to delegate their exported `make*BridgeClientLayer` functions to the shared surface.

The platform review found no blockers. It confirmed that services now keep only durable event policy such as method names, Schema decoding, filtering, and resource-specific stream composition. The architecture-debt sweep removed the mirrored protocol helpers and found no larger wrapper debt in the touched area.

## Why it mattered

The invariant is that generated Effect RPC calls and event subscriptions share one bridge exchange without each service rebuilding the same protocol Layer. The hidden failure mode was module initialization: passing a local client mapper directly into a module-level `NativeSurface.make` can read a `const` before it is initialized. A closure keeps the dependency explicit and evaluates it only when the Layer is built.

## Example

```ts
export const AppSurface = NativeSurface.make("App", AppRpcGroup, {
  service: AppClient,
  handlers: AppHandlersLive,
  client: (client) => appClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => appClientFromRpcClient(client, exchange)
})
```

## Rule candidate

When a shared surface owns Layer construction, pass service-specific policy as deferred functions instead of direct module-local constants. Why: shared construction should remove wrapper debt without introducing temporal initialization coupling.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it - `/learn` never auto-edits AGENTS.md.
