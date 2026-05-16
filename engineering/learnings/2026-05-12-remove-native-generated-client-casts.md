---
date: 2026-05-12
type: in-flight-refactor
topic: Remove native generated-client casts over Effect RPC
issue: https://github.com/Rika-Labs/effect-desktop/issues/1286
pr: none
---

# Remove Native Generated-Client Casts Over Effect RPC

## Decision

When a helper accepts `Schema.Top`, it erases codec service requirements; native RPC factories should
accept pure `Schema.Codec<_, _, never, never>` values so Effect RPC clients stay typed without local
coercion.

## What changed

The plan started as a generated-client deletion: remove each native `*GeneratedClient` interface and
the `Effect.map((client) => client as unknown as *GeneratedClient)` adapter around `RpcClient.make`.
That did remove the obvious casts, but typecheck exposed the deeper cause: RPC helper factories used
broad schema constraints and non-literal method names, so Effect RPC could not keep endpoint names
and codec services precise.

The shipped shape uses `DesktopRpcClient<*Rpc>` directly, preserves endpoint tags with `const Method
extends string`, and constrains RPC payload/success schemas as pure codecs. Window no longer
double-casts a generated client; it builds the supported client group explicitly and tests that the
group matches the `RpcSupport` metadata subset.

## Why it mattered

The important invariant was not just "remove `unknown as`"; it was "do not reintroduce a smaller
coercion helper to hide the same type gap." A temporary `assumeNoClientCodecServices` helper would
have made the code compile, but it would have converted many local casts into one sanctioned cast.
Fixing the schema helper types removed the need for that helper entirely.

Review also showed two remaining debt pockets that should be tracked rather than hidden: native
decode helpers still erase schema purity in some modules, and `DesktopRpc.supportedGroup` still has
a central cast/manual-list tradeoff. These became #1288 and #1289.

## Example

```ts
function menuRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: string) {
  return Rpc.make(`Menu.${method}` as const, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}
```

## Rule candidate

When an Effect RPC client exposes `unknown` services from pure boundary schemas, first inspect broad
`Schema.Top` or type-only `Schema.Schema` annotations before adding a cast helper. Why: the cast
usually masks lost schema precision, not a real runtime dependency.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it — `/learn` never
auto-edits AGENTS.md.
