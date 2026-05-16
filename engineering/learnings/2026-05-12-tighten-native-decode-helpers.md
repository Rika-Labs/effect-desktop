# Tighten Native Decode Helpers

Issue: #1288

## What Changed

Native bridge client decode helpers now require pure `Schema.Codec<..., ..., never, never>` values
instead of widening schemas to `Schema.Schema<unknown>`. This lets
`Schema.decodeUnknownEffect(...)` carry its real `never` environment through the helper, so the
native modules no longer need local `as Effect.Effect<..., ..., never>` assertions to recover the
lost type information.

The host-protocol mapping stayed local to the native boundary. Schema still owns decoding; native
code only turns parse failures into stable desktop errors with operation names.

## What Worked

The previous generated-client cleanup made the remaining type erasure obvious. Once native clients
used `DesktopRpcClient<*Rpc>` directly, the decode helper casts stood out as the next shallow layer:
they were not translating protocol behavior, only compensating for an overly broad helper type.

## Friction

The same pattern still exists deeper in `packages/bridge`: bridge contract specs use broad
`Schema.Schema<unknown>` values, and bridge client/handler/stream code recovers purity with decode
and encode assertions. That scope is bigger than native decode helpers because it touches the
contract type model and stream/client helpers together.

## Durable Rule

When a helper accepts an Effect Schema value, keep the helper generic over the precise codec
requirement. Do not erase schema services and then assert them away locally. If a boundary requires
pure schemas, encode that as `Schema.Codec<..., ..., never, never>` in the helper or contract type.

Follow-up opened: #1290 Tighten bridge contract schemas to pure codecs.
