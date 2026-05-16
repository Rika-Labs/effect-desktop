# ADR-0002: Adopt effect/unstable/rpc and delete bespoke bridge (T01)

## Status

Accepted

## Context

`packages/bridge/` re-implements typed RPC end-to-end across roughly ten files: request/response lifecycle, origin auth, redaction, streams, resources, and handshake. Earlier drafts used a bespoke contract registration surface, which forced contract modules toward effectful module initialization.

Effect v4 ships `effect/unstable/rpc` with the same surface: `Schema.TaggedRequest`, `RpcGroup.make`, `Rpc.fromTaggedRequest`, `RpcServer.layer`, `RpcClient.make`, and `RpcSerialization.msgPack`. Contracts become plain values rather than effectful computations. Registration becomes a `Layer`. No `runPromise` is needed at the module level.

The framework carries ~10 files of duplicate logic that drift from upstream with every Effect release. No ADR documented the original divergence.

The framework must preserve: origin tokens, window IDs, trace IDs, host protocol envelope semantics, and scope-tracked resource disposal. These are desktop-specific concerns that sit beneath the RPC layer, not inside it.

## Decision

Delete the bespoke RPC implementation. Adopt `effect/unstable/rpc` as the bridge backbone.

- Application contracts are defined via `Schema.TaggedRequest` and grouped via `RpcGroup.make`.
- Handlers are bound via `RpcGroup.toLayer(handlers)`.
- The runtime mounts `RpcServer.layer` over a `DesktopProtocolAdapter` — a thin adapter that satisfies `effect/unstable/rpc`'s `Protocol` interface while encoding the host protocol envelope (origin token, window ID, trace ID, request ID).
- The renderer holds a typed `RpcClient.make(group)` consuming the same protocol.
- The host protocol envelope schema (`HostProtocolRequestEnvelope`, response, stream frame) becomes the sole wire-format truth. Only the adapter reads or writes it.
- Re-export `RpcGroup`, `Rpc`, `RpcClient`, `RpcServer`, and `RpcSerialization` from `@effect-desktop/core` so contract authors have one import root.
- No transitional contract shim is kept before v1.0. The only contract value is a `RpcGroup`.

Cross-links: [ADR-0006](adr-0006-socket-transport.md) (transport the Protocol adapter sits on), [ADR-0007](adr-0007-opentelemetry.md) (spans emitted per RPC call), [ADR-0018](adr-0018-cluster-multi-window.md) (cluster entities communicate over the same RPC groups).

## Alternatives considered

**Keep bespoke**: the surface works today but drifts every release. Carrying it past v1.0.0 is an undocumented permanent fork.

**Wait for stable**: `effect/unstable/rpc` is production-used upstream. Waiting indefinitely while shipping a known divergence is worse than pinning and tracking the beta changelog.

**Fork upstream**: adds ownership without improving the situation. Rejected.

## Consequences

**Positive**

- Contracts are pure values; no top-level `runPromise` in contract modules.
- Single code path through RPC; no parallel surfaces to keep in sync.
- Origin token, window ID, and trace ID semantics are preserved in the adapter, not scattered across bespoke files.
- RPC spans flow to `@effect/opentelemetry` (T06) for free via Effect's `Tracer`.

**Negative**

- `effect/unstable/rpc` API may change before stable. The `DesktopProtocolAdapter` isolates breakage to one file; contract definitions using `Schema.TaggedRequest` are stable by schema contract.

**Neutral**

- Migration rewrites every bespoke contract module. Scope is bounded by the bridge package surface area.

## Validation

A `Schema.TaggedRequest` defined in shared code round-trips renderer to runtime via `RpcClient.make` and `RpcServer.layer` with origin token, window ID, and trace ID present on the envelope. The framework's own contracts (Window, Permission) compile as `RpcGroup`s. `bun run typecheck` and `bun test` pass with no reference to the deleted bespoke files.

## Migration notes

1. Keep the host envelope modules that own desktop protocol concerns.
2. Make `RpcGroup` the only contract model at the app, bridge, and native boundaries.
3. Add re-exports of `RpcGroup`, `Rpc`, `RpcClient`, `RpcServer` from `@effect-desktop/core`.
4. Delete pre-release contract shims instead of deprecating them.
