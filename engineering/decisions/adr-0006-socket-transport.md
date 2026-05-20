# ADR-0006: Adopt effect/unstable/socket for renderer-runtime transport (T05)

## Status

Accepted

## Context

`packages/core/src/runtime/transport.ts` hand-rolls length-prefixed and JSON-RPC framing for renderer–runtime IPC. Wire-format edge cases — partial reads, frame boundaries, backpressure, error propagation — are owned by this file and drift from anything the upstream RPC stack expects.

Effect v4's `effect/unstable/socket` exposes `Socket.make` with the same framing schemes already implemented and tested upstream. The RPC layer (T01) expects a `Protocol` interface; a standard `Socket` satisfies it directly without custom adapter glue.

Two concrete transports are needed:

1. **stdio** — the Bun runtime process talking to the Rust host.
2. **postMessage** — the WebView renderer talking to the host, relayed through the native bridge.

Both sides of the bridge currently share the same bespoke framing code; both can be replaced with a standard `Socket`.

## Decision

Delete the bespoke transport. Adopt `effect/unstable/socket` for renderer–runtime IPC.

- Two concrete adapters are written on top of `Socket.make`:
  - A **stdio Socket adapter** that maps the runtime–host stdio streams onto a `Socket`.
  - A **postMessage Socket adapter** that maps the WebView postMessage channel onto a `Socket`.
- Both adapters expose the standard `Socket` shape and satisfy `effect/unstable/rpc`'s `Protocol` interface.
- Host protocol envelope encode/decode lives only inside the adapter. Everything above the adapter sees standard `Socket` and `Protocol` semantics.
- Re-export `Socket` and `Socket.make` from `@orika/core`.
- Framing (length-prefix or JSON-RPC) comes from `effect/unstable/socket`, not hand-rolled code.

Cross-links: [ADR-0002](adr-0002-rpc-effect-unstable-rpc.md) (RpcServer mounts over the Protocol this adapter exposes), [ADR-0018](adr-0018-cluster-multi-window.md) (WebViewRunner uses the postMessage adapter as its transport).

## Alternatives considered

**Keep bespoke transport**: works today but drift accumulates with every Effect release and the framing code never aligns with what `effect/unstable/rpc` expects. Rejected.

**Use a custom WebSocket bridge**: adds a second network stack inside a desktop app. Unnecessary complexity. Rejected.

**Single adapter for both directions**: stdio and postMessage have different origin-check semantics. A single adapter would have to branch on direction internally, which is worse than two clean adapters. Rejected.

## Consequences

**Positive**

- Framing edge cases (partial reads, backpressure) are owned by the upstream module.
- `RpcServer.layer` and `RpcClient.make` mount on the adapters with no bespoke glue (T01 story is clean).
- Wire-format change is one file per adapter; nothing above the adapter changes.

**Negative**

- `effect/unstable/socket` is beta; `Socket.make` API may shift before stable. Breakage is isolated to the two adapter files.
- Two adapters to maintain rather than one bespoke file, though each adapter is simpler than the current file.

**Neutral**

- The host protocol envelope schema is unchanged; the Rust host does not require modification.

## Validation

A `Schema.TaggedRequest` round-trips renderer to runtime over the postMessage adapter and runtime to host over the stdio adapter, both backed by `effect/unstable/socket`, with the host protocol envelope preserved across both hops. The bespoke `runtime/transport.ts` is deleted; `bun run typecheck` and `bun test` pass.

## Migration notes

1. Delete `packages/core/src/runtime/transport.ts`.
2. Add `effect/unstable/socket` to `packages/core`.
3. Write `StdioSocketAdapter` and `PostMessageSocketAdapter`.
4. Add re-exports of `Socket` from `@orika/core`.
5. Mount adapters in the spine layer; confirm T01's `RpcServer.layer` and `RpcClient.make` resolve without additional glue.
