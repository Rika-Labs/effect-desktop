# Generate Desktop Surfaces from RpcGroup

Issue: #1193

## What changed

`ScreenRpcs` is now the canonical Effect `RpcGroup` for the public Screen contract. `ScreenSurface` owns the generated handler/client/test layer shape and maps the generated RPC client back into the durable `ScreenClient` service API.

The remaining bridge exchange path is isolated behind a unary adapter, `makeUnaryDesktopTransportFromBridgeClientExchange`, so bridge transport compatibility does not leak into the public Screen contract.

## What mattered

Effect RPC owns generated request IDs for this path. The Screen bridge client options now omit `nextRequestId`, which prevents a caller from supplying a hook the generated protocol would ignore.

The bridge compatibility edge also had to normalize Effect RPC void payloads from `null` to omitted payload for existing Screen bridge handlers. That compatibility belongs at the adapter boundary, not in the canonical `RpcGroup`.

## Rule

When replacing a custom RPC DSL with Effect RPC, keep the public contract pure and push old wire-shape compatibility into a named adapter. Adapter names must state their real capability, especially when they only support unary request/response calls.
