# Issue #1154: Make RpcGroup the only renderer contract

## Decision

Make canonical Effect `RpcGroup` values the only authoring surface for renderer-callable desktop APIs. Remove bridge-spec authoring from native capabilities instead of preserving a compatibility path.

## Problem

What is true now: renderer templates and framework adapters already use `Rpc.make` and `RpcGroup.make`, but native capability modules still author public contracts through `BridgeRpcSpec` and `BridgeRpc.group`.

What must remain true: existing host protocol envelopes, bridge clients, and handler dispatch continue to work from `RpcGroup` metadata while the user-facing contract source is Effect RPC only.

What should be true: a native capability exports `Rpc` values and one `RpcGroup`; any bridge runtime dispatch metadata is derived below that boundary instead of being authored as a parallel contract.

## Files to change

- `packages/bridge/src/contracts.ts` - replace bridge-spec group authoring with `RpcGroup`-derived metadata helpers used by bridge internals.
- `packages/bridge/src/contracts.test.ts` - prove capability, endpoint, support, and schema metadata come from hand-authored Effect RPCs.
- `packages/native/src/screen.ts` - convert a native capability to canonical `Rpc.make` + `RpcGroup.make` authoring.
- `packages/native/src/index.test.ts` and `packages/native/src/window.test.ts` - assert behavior through `RpcGroup` requests instead of public bridge specs where touched.
- `docs/roadmap/layer-first-issue-order.md` - record progress for #1154 after verification.

## Test-first plan

1. Add a bridge contract test that starts from a hand-authored `RpcGroup` and derives the metadata the bridge runtime needs.
2. Convert one native domain to export individual `Rpc` values plus a canonical `RpcGroup`.
3. Remove bridge-spec authoring from the converted domain so `Client(...)` and `Handlers(...)` dispatch from `RpcGroup`-derived metadata.
4. Run focused bridge/native tests, then repo checks.

## Review criteria

- Public capability contracts are authored with `Rpc.make` and grouped with `RpcGroup.make`.
- Bridge-specific metadata is carried as annotations on RPC values.
- Runtime metadata is derived below the public surface and does not become a new authoring DSL.
- The slice is intentionally narrow; broad generation work remains in #1193 and Layer-first service generation remains in #1233.

## Risks

- Resource outputs still need explicit bridge metadata until they are represented as ordinary schema-coded RPC success values.
- Existing native domains still using `BridgeRpcSpec` remain visible debt and should be migrated after the first `RpcGroup`-only domain lands.
- Type inference for clients may need follow-up generator work to avoid hand-maintained compatibility types.

## Verification

- `bun test packages/bridge/src/contracts.test.ts`
- `bun test packages/native/src/index.test.ts packages/native/src/window.test.ts`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:types`
- `bun run format:check`
