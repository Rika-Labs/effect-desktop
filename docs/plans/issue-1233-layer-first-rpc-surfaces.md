# Issue #1233: Make generated RPC surfaces Layer-first

## Decision

Add `DesktopRpc.surface` in core as the single Layer-first packaging point for an Effect `RpcGroup`. The helper groups the canonical RPC contract with its server layer, generated client layer, generated test client layer, schema docs, and contract-law checks.

## Problem

What is true now: `RpcGroup` is the renderer-callable boundary and `Desktop.Rpcs.layer(...)` can attach a handler layer to an app.

What must remain true: the app manifest, framework RPC descriptors, and bridge metadata keep using the same `RpcGroup` identity and annotations. `BridgeRpc.fromGroup` remains the bridge-specific lowering step, not a second public authoring contract.

What should be true: a capability can define one `RpcGroup` and use that declaration to expose server, client, and test client layers plus metadata that framework adapters and tests can inspect.

## Files to change

- `packages/core/src/runtime/desktop-rpc-surface.ts` - own `DesktopRpc.surface`, generated layers, schema docs, and contract-law hooks.
- `packages/core/src/index.ts` - export `DesktopRpc` and mount it under `Desktop.Rpc`.
- `packages/core/src/index.test.ts` - prove a single `RpcGroup` produces server, client, test, docs, and laws.
- `packages/native/src/screen.ts` - prove the surface on one real native capability without replacing bridge host transport helpers.
- `packages/native/src/index.test.ts` - verify `ScreenSurface` metadata, generated test client layer, and app descriptor integration.
- `docs/roadmap/layer-first-issue-order.md` - record progress for #1233 after verification.

## Test-first plan

1. Add a core test that defines a small `RpcGroup` and expects `Desktop.Rpc.surface(...)` to produce usable server/client/test layers.
2. Add a native `ScreenSurface` proof because `Screen` already has `ScreenLive`, bridge client wiring, and deterministic test fixtures.
3. Verify `ScreenSurface` preserves the canonical group identity used by `ScreenRpcs`, manifests, and `describeRpcs`.
4. Verify generated schema docs and contract laws expose the same endpoint and capability metadata carried by the RPC annotations.
5. Run focused core/native tests, typecheck, lint, API snapshot generation, and full local checks.

## Review criteria

- `DesktopRpc.surface` composes existing Effect primitives instead of introducing another RPC DSL.
- `RpcGroup` remains the single source of truth for endpoint names, schemas, capabilities, and support metadata.
- Generated client/test layers are Effect `Layer`s and are consumed through a service requirement.
- The first vertical slice is intentionally narrow; broad native generation belongs to #1193 and #1179.

## Risks

- Overfitting the helper to native bridge clients instead of core Effect RPC clients.
- Losing precise `RpcGroup` type inference when bridge metadata is attached to an existing group object.
- Accidentally exporting host-only runtime internals through renderer subpaths.
- Treating docs metadata as a substitute for executable contract laws.

## Verification

- `bun test packages/core/src/index.test.ts`
- `bun test packages/native/src/index.test.ts`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:types`
- `bun packages/cli/src/bin.ts check --api --write`
- `bun packages/cli/src/bin.ts check --api`
