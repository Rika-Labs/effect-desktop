---
date: 2026-05-12
type: in-flight-refactor
topic: Replace BridgeRpc resource helpers with Schema handles
issue: https://github.com/Rika-Labs/effect-desktop/issues/1285
pr: none
---

# Replace BridgeRpc Resource Helpers With Schema Handles

## Decision

Resource handles should be plain core-owned Schema values at the protocol boundary, while disposer-bearing handles stay inside the runtime registry.

## What changed

The plan was to replace `BridgeRpc.Resource(kind, state)` in native contracts with `ResourceHandleSchema(kind, state)` and then delete the bridge resource spec/proxy path. That shipped, but review uncovered a second boundary that mattered: the registry previously exposed the same handle shape for both public snapshots and managed lifetime internals.

The final design split `ResourceHandle` from `ManagedResourceHandle`. Native contracts and bridge payloads use serializable handles. Core services that own cleanup receive managed handles with `dispose`. Registry reads (`get`, `list`, `observe`, `assertFresh`) now strip `dispose`, and `share` atomically validates kind, state, generation, and disposal state before creating a shared handle.

## Why it mattered

The non-obvious invariant is that "handle freshness" is not only id plus generation. State is part of the capability: a forged handle with the right id/generation but the wrong state must not be shareable or fresh. Review caught that removing a bridge DSL exposed this core invariant more clearly.

## Example

```ts
export const WebViewResource = ResourceHandleSchema("webview", "open")
export type WebViewHandle = ResourceHandle<"webview", "open">

export class WebViewHandleInput extends Schema.Class<WebViewHandleInput>("WebViewHandleInput")({
  webview: WebViewResource
}) {}
```

## Rule candidate

When splitting serializable protocol values from runtime-owned resources, tests must prove public reads cannot leak disposer functions and freshness checks validate every authority-bearing field. Why: removing wrapper DSLs often reveals lifecycle invariants that the wrapper was accidentally hiding.
