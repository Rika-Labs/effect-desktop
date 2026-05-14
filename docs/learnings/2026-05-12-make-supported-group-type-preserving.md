# Make Supported Group Type-Preserving

Issue: #1289

## What Changed

`DesktopRpc.supportedGroup` now accepts a canonical Effect `RpcGroup.RpcGroup<Rpcs>` and filters it
with a typed `isSupportedRpc` predicate. `RpcGroup.make(...)` preserves the narrowed
`SupportedRpc<Rpcs>` union directly, so the helper no longer recovers the result with
`as unknown as SupportedDesktopRpcGroup<Group>`.

At the time, Window derived `WindowSupportedRpcs` from `DesktopRpc.supportedGroup(WindowRpcs)`.
Later cleanup removed descriptor-only unsupported Window RPCs, so `WindowRpcs` and
`WindowSupportedRpcs` now share the same callable `Window.create` / `Window.close` contract.

## What Worked

The key was removing the structural `RpcGroupWithRequests` intersection from the helper signature.
That intersection erased request values back to `Rpc.Any`; typing the helper directly over
`RpcGroup.RpcGroup<Rpcs>` let TypeScript carry the union through the filter predicate.

Review also found that public raw RPC annotation tags could let callers bypass `RpcSupport` and
create runtime/type marker drift. Making those annotation tags private keeps the exported helpers as
the only path that writes metadata and marker types together.

## Friction

The cleanest inferred Window export produced an unreadable public API snapshot because the full
`typeof WindowRpcs` union expanded inline. A derived `WindowSupportedRpc = SupportedRpc<WindowRpcUnion>`
alias kept the API legible without reintroducing the old manual supported-RPC list.

## Durable Rule

When a helper narrows an Effect RPC surface by local policy metadata, type it around the canonical
Effect primitive first. Add local metadata helpers only at the policy boundary, and keep raw
annotation keys private so runtime metadata and phantom marker types cannot diverge.
