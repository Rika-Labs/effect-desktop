# Issue #1193: Generate desktop surfaces from Effect RpcGroup

## Decision

Finish one native vertical slice by making `Screen` expose a pure Effect `RpcGroup` plus a
`DesktopRpc.surface` as the public generated surface. Bridge-specific code remains only as a
compatibility adapter at the host protocol edge.

## Problem

#1233 added the generic surface generator, but `Screen` still publicly exports an object widened
with bridge DSL metadata and still builds bridge clients through `Client({ Screen: ScreenRpcs },
...)`. That keeps two client-generation models in the same capability.

## Files to change

- `packages/bridge/src/client.ts` - add a unary bridge-exchange transport adapter for
  `makeDesktopClientProtocol`.
- `packages/bridge/src/protocol.ts` - validate generated request/cancel protocol fields before
  mutating pending request state.
- `packages/native/src/screen.ts` - export `ScreenRpcs` as the pure `RpcGroup`, map
  `ScreenSurface` to the durable `ScreenClient` service, and implement the unary bridge client
  layer via `ScreenSurface.clientLayer`.
- `packages/native/src/index.ts` - remove the public `ScreenRpcClient` export if no longer needed.
- `packages/native/src/index.test.ts` - assert the pure group, generated surface, mapped client
  layer, and bridge client behavior.
- `api/snapshots/@effect-desktop__bridge.snapshot.json` and
  `api/snapshots/@effect-desktop__native.snapshot.json` - update public API snapshots.

## Thin wrappers in scope

- Remove now: `ScreenRpcClient`, because it only renames `RpcClient.RpcClient`.
- Remove now: `makeScreenBridgeClient` based on `Client(...)`, because `RpcClient.make` already
  derives the client from the `RpcGroup`.
- Keep for #1264: `BridgeRpc.fromGroup`, `BridgeRpc.layer`, `BridgeRpcSpec`, and the generic
  `Client(...)` bridge DSL. They still own broad host-protocol compatibility outside this narrow
  `Screen` proof.

## Verification

- `bun test packages/native/src/index.test.ts`
- `bun test packages/core/src/index.test.ts`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:types`
- `bun packages/cli/src/bin.ts check --api --write`
- `bun packages/cli/src/bin.ts check --api`
