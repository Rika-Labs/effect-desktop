# Issue #1264: Replace BridgeRpc Runtime DSL With Effect RPC Adapters

## Decision

Move native host dispatch off `BridgeRpc.fromGroup(...)` and `BridgeRpc.layer(...)`. Native capabilities should publish Effect `RpcGroup` values, implement handlers with `RpcGroup.toLayer(...)`, and lower host protocol envelopes through a desktop-specific adapter that reads Effect RPC schemas and handlers directly.

## First slice

Convert `Screen` and `Window`, because they are the generated native proofs from #1193 and #1179. They currently keep private `BridgeRpc.fromGroup(...)` values only so host tests can call `Handlers.withOptions(..., BridgeRpc.layer(...))`.

## Files to change

- `packages/bridge/src/rpc-handlers.ts` - add an Effect RPC handler runtime that accepts an Effect `RpcGroup`, a handler layer, and host protocol options, then dispatches `HostProtocolRequestEnvelope` through RPC payload/error/success schemas.
- `packages/bridge/src/index.ts` - export the new adapter.
- `packages/native/src/screen.ts` - remove `ScreenBridgeRpcs`, `ScreenRpcSpec`, `BridgeRpc.layer`, and `BridgeRpc.fromGroup`; expose a host runtime factory backed by `ScreenHandlersLive`.
- `packages/native/src/window.ts` - remove `WindowBridgeRpcs`, `WindowRpcSpec`, `BridgeRpc.layer`, and `BridgeRpc.fromGroup`; expose a host runtime factory backed by `WindowRpcGroup.toLayer(...)`.
- `packages/native/src/index.test.ts` and focused bridge/native tests - update host bridge test wiring to use the Effect RPC runtime adapter.
- API snapshots and docs - update public names and explain that host dispatch now consumes Effect `RpcGroup` directly.

## Thin wrappers in scope

- Remove now: private native `BridgeRpc.fromGroup(...)` values and `BridgeRpc.layer(...)` host binding calls.
- Keep temporarily: `BridgeRpc.Resource(...)` and `BridgeRpc.Stream(...)` where they still carry desktop resource/stream metadata not represented cleanly by plain Effect schemas yet.
- Keep temporarily inside `packages/bridge`: legacy `BridgeRpc.group`, `BridgeRpc.layer`, and bridge `Client(...)` tests until the bridge package itself is migrated. They no longer define native capability architecture after this slice.

## Risks

- Effect RPC's built-in server protocol maps schema decode defects differently than the legacy bridge runtime. The adapter must preserve current host protocol behavior: malformed request payloads fail as `InvalidArgument`, malformed successful outputs fail as `InvalidOutput`, and handler failures are encoded as typed failure responses.
- The adapter should remain a protocol boundary, not a second DSL. It may translate host envelopes, origin checks, and schema encoding, but it must not own method specs separate from the `RpcGroup`.

## Verification

- `bun test packages/bridge/src/protocol.rpc.test.ts packages/native/src/index.test.ts packages/native/src/window.test.ts`
- `bun run typecheck`
- `bun test`
- `bun run check`
- `bun run lint`
- `bun run lint:types`
- `bun packages/cli/src/bin.ts check --api --write`
- `bun packages/cli/src/bin.ts check --api`
- changed-file Prettier check
- `git diff --check`
