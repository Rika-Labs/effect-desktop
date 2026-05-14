# Issue #1289: Make `DesktopRpc.supportedGroup` Type-Preserving

## Problem

`DesktopRpc.supportedGroup(group)` filtered a full `RpcGroup` by `RpcSupport` metadata, then recovered the narrower supported group with `as unknown as SupportedDesktopRpcGroup<Group>`. `WindowSupportedRpcs` avoided that cast by manually spelling the supported Window RPC union and supported group, which duplicated the `RpcSupport` metadata source of truth.

## Architecture

Keep `DesktopRpc.supportedGroup(group)` as the desktop policy helper because it owns one durable rule: renderer clients may call only RPCs marked `RpcSupport.supported`.

Make the helper type-preserving by:

1. Typing `supportedGroup` directly over `RpcGroup.RpcGroup<Rpcs>`.
2. Filtering `group.requests.values()` through an `isSupportedRpc` type predicate.
3. Returning `RpcGroup.RpcGroup<SupportedRpc<Rpcs>>` from `RpcGroup.make(...)` without a recovery cast.

Then make Window consume that single source of truth:

```ts
export const WindowSupportedRpcs = DesktopRpc.supportedGroup(WindowRpcs)
export type WindowSupportedRpc = SupportedRpc<WindowRpcUnion>
type WindowRpcClient = DesktopRpcClient<WindowSupportedRpc>
```

## Verification

- Core type tests prove `DesktopRpc.supportedGroup(NotesRpcs)` narrows the group union to only the supported RPC.
- Native tests prove `WindowSupportedRpcs.requests.keys()` equals the runtime `rpcSupport(...).status === "supported"` subset of `WindowRpcs`.
- Native type tests prove supported Window clients expose `Window.create` and `Window.close`, while `Window.show` is absent.
- Repository search must show no remaining `supportedGroup` double-cast and no manual `WindowSupportedRpc = typeof WindowCreate | typeof WindowClose` implementation debt.

## Architecture-Debt Sweep

Removed now:

- The central `DesktopRpc.supportedGroup` double-cast over Effect RPC.
- The manual Window supported-RPC union and manual `RpcGroup.make(WindowCreate, WindowClose)` supported group.
- Public raw RPC annotation tags, so callers cannot bypass the metadata helpers and create runtime/type marker drift.

Kept:

- `DesktopRpc.supportedGroup`, because it adds desktop-specific policy by deriving the callable native surface from support metadata.
- `RpcSupport` marker assertions inside the bridge helper, because Effect annotations do not project custom TypeScript marker types without that metadata helper.
