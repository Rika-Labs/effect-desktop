# Issue 1230: Require Live Test and Client Layers

## Intent

Layer-first should be a per-capability shipping requirement, not only a root architecture principle. A native capability should expose one public service requirement plus replaceable Live, Client, and Test layers that can run the same user-level program without branching.

## Current State

- `Screen` is the strongest vertical slice: `ScreenLive`, `ScreenSurface`, `makeScreenBridgeClientLayer`, `ScreenTest(...)`, and an existing substitution test already prove Live/Client/Test replacement.
- `Clipboard` and `Dialog` already have schema-coded RPC groups, `*Live`, bridge client layers, service-layer constructors, and deterministic test layers.
- `Clipboard` and `Dialog` still hand-roll local `RpcClient.make(...)` bridge clients instead of deriving clients through `DesktopRpc.surface(...)` like `Screen`.
- Deterministic test layers live correctly in `@orika/test`; exporting them from `@orika/native` would invert package boundaries.

## Plan

1. Treat the capability template as documentation and executable tests, not a new runtime DSL over `Layer`.
2. Promote `Clipboard` to the generated `DesktopRpc.surface(...)` shape:
   - add `ClipboardHandlersLive`;
   - add `ClipboardSurface`;
   - make `makeClipboardBridgeClientLayer(...)` use the generated client layer plus the existing bridge protocol adapter.
3. Promote `Dialog` to the generated `DesktopRpc.surface(...)` shape:
   - add `DialogHandlersLive`;
   - add `DialogSurface`;
   - make `makeDialogBridgeClientLayer(...)` use the generated client layer plus the existing bridge protocol adapter.
4. Add one shared contract suite in `@orika/test` that runs the same user-level program through direct Live, bridge Client, and Test layers for at least:
   - `Screen`: primary display lookup;
   - `Clipboard`: text write/read/clear;
   - `Dialog`: deterministic open/save/confirm/message behavior.
5. Update the Layer-first contract docs and roadmap evidence for #1230.

## Architecture-Debt Sweep

- Removed scoped debt: `Clipboard` and `Dialog` no longer build bridge clients with local `RpcClient.make(...)` loops. Both derive their bridge clients from generated `DesktopRpc.surface(...)` client layers.
- Kept one boundary adapter: extracted bridge clients still acquire the generated surface client inside each method's scoped Effect so protocol scope does not close before the method is called.
- Did not add a public `defineCapabilityContract(...)` helper or `CapabilityContract` runtime object; grouping existing `Layer` values would be a thin abstraction without durable desktop semantics.
- Kept deterministic native test clients in `@orika/test`; #1271 already tracks generating these clients from `DesktopRpc` surfaces later.
- Kept broader `BridgeRpc` cleanup out of scope; #1292 already tracks removing it once Effect RPC fully owns renderer contracts.
- No additional thin wrappers, custom DSLs, or `unknown as` assertions were added in the touched capability path.

## Verification

- `bun test packages/native/src/index.test.ts packages/test/src/index.test.ts tests/layer-first-contract.test.ts`
- `bun run typecheck --filter=@orika/native --filter=@orika/test`
- `bun packages/cli/src/bin.ts check --api --write`
- `bun packages/cli/src/bin.ts check --api`
- Full local validation before push.
