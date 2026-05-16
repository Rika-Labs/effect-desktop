# Tighten Bridge Contract Schemas

Issue: #1290

## What Changed

Bridge method, event, and stream specs now require pure
`Schema.Codec<..., ..., never, never>` values. Client, handler, event, and stream helpers call
Effect Schema encode/decode directly and only map parse failures into host-protocol errors; they no
longer recover erased schema services with `as Effect.Effect<..., ..., never>` assertions.

`BridgeRpc.fromGroup` was tightened during review as well. It now requires RPC request metadata
whose payload, success, and error schemas are pure bridge codecs, and stream metadata flows through
a typed `RpcSchema.Stream<BridgeRpcCodec, BridgeRpcCodec>` guard instead of a local structural cast.

## What Worked

The native decode-helper cleanup in #1288 made the bridge issue obvious: the bridge had the same
pattern, but the root cause was one layer higher in the contract spec types. Fixing the spec type
let the helper code become simpler instead of adding more local annotations.

Review agents caught the important remaining hole: `fromGroup` initially still accepted erased
`Rpc.Any` metadata and treated the schemas as pure after the fact. Adding a type-level regression
test for serviceful RPC schemas kept the fix honest.

## Friction

Effect RPC group types are intentionally broad around `RpcGroup.Any`, so preserving schema purity
through `fromGroup` required typing the request metadata structurally instead of forcing the whole
group into a narrower `RpcGroup.RpcGroup<...>` generic. The latter fought method variance on RPC
builders and made normal pure groups fail typecheck.

## Durable Rule

When a bridge adapter derives metadata from Effect RPC, constrain the metadata at the adapter
boundary instead of casting after erasure. If the runtime cannot provide schema services, the
contract type must reject serviceful schemas before helper code reaches encode/decode.
