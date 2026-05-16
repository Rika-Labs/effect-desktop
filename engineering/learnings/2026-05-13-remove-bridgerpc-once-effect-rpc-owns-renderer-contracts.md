# Remove BridgeRpc Once Effect RPC Owns Renderer Contracts

Issue: #1292

## What changed

Bridge contracts now start from canonical Effect `Rpc.make(...)` values collected with
`RpcGroup.make(...)`. The bridge package no longer exposes `BridgeRpc.group`,
`BridgeRpc.layer`, `BridgeRpc.fromGroup`, or `BridgeRpc.Stream` as a second authoring language.

Bridge-specific code remains where it owns desktop protocol semantics: endpoint intent,
capability/support metadata, timeout/cancel/cache policy, stream/event backpressure, validation,
and lowering from `RpcGroup` into renderer/native metadata.

## What mattered

Removing a wrapper is not finished when the public object disappears. The first implementation still
had two hidden sources of truth: event specs were passed beside the `RpcGroup`, and caller-supplied
contract generics could claim a shape that the group did not actually contain.

The final shape derives methods and events from the `RpcGroup` itself. Event payload and
backpressure now live on `${tag}.events.*` stream RPCs through bridge annotations, which keeps
Effect RPC as the contract source and the bridge as a metadata-lowering boundary.

```ts
const Changed = Rpc.make("Project.events.changed", {
  success: ProjectChangedEvent,
  error: Schema.Never,
  stream: true
}).pipe(BridgeRuntime({ backpressure: { strategy: "drop", size: 16 } }))

export const Project = bridgeContractFromRpcGroup("Project", RpcGroup.make(OpenProject, Changed))
```

## Review changes

Review changed the design in three places:

- event streams moved into the canonical `RpcGroup` instead of a parallel event spec;
- caller-provided `Spec`/`Events` generics were removed from `bridgeContractFromRpcGroup`;
- `idempotent` was removed from bridge metadata because endpoint intent belongs to Effect RPC
  endpoint annotations, not a bridge method field.

## Architecture-debt sweep

The scoped debt removed here was the public `BridgeRpc` DSL and the spec-to-Rpc construction path.
The remaining bridge helpers are not contract authoring wrappers; they preserve durable
native/renderer protocol policy and schema-backed validation around canonical Effect RPC contracts.

No follow-up issue was opened for `BridgeRpc` because the wrapper was removed in this ticket.

## Rule

When deleting an adapter over Effect, review value constructors, metadata side channels, and
type-level generics together; otherwise a renamed wrapper can survive without a value-level API.
