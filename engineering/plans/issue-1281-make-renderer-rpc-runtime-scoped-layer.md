# Issue #1281: Make Renderer RPC Runtime a Scoped Layer

## Objective

Replace the core renderer RPC imperative runtime with Effect services and scoped layers. Core should not allocate unsafe scopes or synchronously run effects to build clients; framework adapters own the bridge from synchronous UI lifecycles to Effect `ManagedRuntime`.

## Pre-change Shape

- `packages/core/src/runtime/renderer-rpc-client.ts` builds client maps with `Scope.makeUnsafe`, `Effect.runSync`, and an imperative `dispose`.
- Core selects `options.transport ?? globalRendererRpcTransport()` during client construction.
- React, Vue, Solid, and Notes tests consume the imperative runtime object.
- #1166 intentionally exposed `rpcLayers` for `RpcTest`, but the test runtime still used the same unsafe core runtime shape.

## Target Shape

- Add `RendererRpcClients` as the renderer client-map service.
- Add `RendererRpcTransport` as the transport service.
- Add a scoped renderer client layer that receives transport through the environment and acquires `RpcClient` protocol resources inside the layer scope.
- Add a scoped `RpcTest` client layer for demo/test RPC handler layers.
- Keep global transport installation as renderer-edge API only; adapters explicitly choose a prop transport, installed global transport, or a typed missing-transport layer.
- React, Vue, and Solid create `ManagedRuntime` instances from the renderer RPC layer and dispose them in their existing framework cleanup hooks.

## Architecture Debt Sweep

Remove now:

- `makeDesktopRendererRpcRuntime` in core, because it is a thin custom runtime over `Layer`, `Scope`, and `RpcClient.Protocol`.
- `makeDesktopRendererRpcTestRuntime`, because `RpcTest` clients should also be layer-scoped.
- Implicit global transport selection inside core client acquisition.

Keep as follow-ups:

- Shared endpoint binding across React/Vue/Solid remains larger than this issue and is already tracked by #1207.
- Framework async/query/stream wrappers are tracked by #1162, #1169, #1170, and #1210.

## Verification

- Focused:
  - `bun test packages/core/src/runtime/renderer-rpc-client.test.ts`
  - `bun test packages/react/src/index.test.ts packages/vue/src/index.test.ts packages/solid/src/index.test.ts apps/examples/notes-common/src/index.test.ts`
- Full before push:
  - `bun run format:check`
  - `git diff --check`
  - `bun run typecheck`
  - `bun run lint`
  - `bun run lint:types`
  - `bun run check`
  - `bun test`
  - `bun run build`
  - `bun run desktop check --api`
  - `cargo fmt --check`
  - `cargo check --workspace`
  - `cargo test --workspace`
  - `cargo clippy --workspace --all-targets -- -D warnings`

## Out of Scope

- Replacing the bridge host protocol transport.
- Rewriting framework hook/query/stream state machines.
- Changing RPC tags, schemas, or protocol envelope formats.
