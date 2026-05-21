# Issue #1292: Remove BridgeRpc Once Effect RPC Owns Renderer Contracts

## Intent

`BridgeRpc` should stop being a public contract-authoring DSL. Renderer-callable contracts should be
plain Effect `Rpc.make(...)` values collected in `RpcGroup.make(...)`, with bridge-specific helpers
limited to metadata annotations and host-protocol lowering.

## Current State

- Production native capabilities already author canonical Effect `RpcGroup` values.
- `packages/bridge/src/contracts.ts` still exports `BridgeRpc.group(...)`,
  `BridgeRpc.fromGroup(...)`, `BridgeRpc.layer(...)`, and `BridgeRpc.Stream(...)`.
- The remaining direct users are bridge tests and `@orika/test` helpers.
- Durable bridge semantics still need a home: endpoint intent, capability metadata, support
  metadata, handler timeout/cancellation policy, stream/event backpressure, event streams, and
  validation before host protocol lowering.

## Plan

1. Replace the `BridgeRpc` object with bridge-specific primitives that do not author RPCs:
   - `bridgeContractFromRpcGroup(tag, group)` lowers an Effect `RpcGroup` into the bridge
     metadata shape used by legacy bridge client/event/stream helpers.
   - `makeBridgeHandlerLayer(contract, handlers)` keeps bridge runtime test binding explicit
     without pretending to define the RPC contract.
   - `BridgeRuntime(...)` annotates Effect `Rpc` values with timeout, cancellation, cache, and
     backpressure policy that Effect RPC does not model locally.
2. Rename public bridge metadata types away from `BridgeRpc*` to `BridgeContract*` /
   `BridgeMethod*` names and update bridge/test consumers.
3. Convert bridge and test package fixtures to author contracts with `Rpc.make(...)` /
   `RpcGroup.make(...)` plus `RpcEndpoint`, `RpcCapability`, `RpcSupport`, and `BridgeRuntime`.
4. Remove the old spec-to-Rpc authoring path entirely:
   - no `BridgeRpc.group`;
   - no `BridgeRpc.layer`;
   - no `BridgeRpc.fromGroup`;
   - no `BridgeRpc.Stream`.
5. Update docs, API snapshots, and roadmap evidence.

## Architecture-Debt Sweep

- Remove now: the public `BridgeRpc` authoring object and spec-to-Rpc constructor path.
- Keep as durable bridge policy: stream/event backpressure specs, runtime timeout/cancel/cache
  annotations, validation, and lowering from canonical `RpcGroup` to host protocol metadata.
- Do not add a new custom RPC authoring DSL under a different name.
- If `Client`, `Handlers`, `Streams`, or `EventHub` still look like thin wrappers after this, open a
  follow-up only if their remaining semantics are fully covered by canonical Effect RPC adapters.

## Verification

- `rg "BridgeRpc" packages apps templates tests docs api/snapshots` should find only historical
  engineering/learnings or this plan while the implementation is in flight.
- `bun test packages/bridge/src/contracts.test.ts packages/bridge/src/client.test.ts packages/bridge/src/handlers.test.ts packages/bridge/src/streams.test.ts packages/test/src/index.test.ts`
- `bun run typecheck --filter=@orika/bridge --filter=@orika/test`
- `bun packages/cli/src/bin.ts check --api --write`
- Full local validation before push.
