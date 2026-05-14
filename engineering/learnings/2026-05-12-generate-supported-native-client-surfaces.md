# Generate supported native client surfaces

Issue #1179 made support metadata part of generated client shape, not just documentation. Later cleanup tightened the rule further: `WindowRpcs` now exposes only host-backed methods, so descriptor-only planned methods do not enter the public client path.

The useful boundary was: planned methods are not methods on `WindowClientApi`, React Window helpers, or test clients until the host can implement them. That prevents descriptor-only operations from looking like ordinary successful service methods.

The generated Window client exposed two adapter rules worth keeping:

- Effect RPC success schemas must be real schemas. Bridge resource specs can still exist for compatibility metadata, but generated `RpcClient` paths need schema-backed payloads.
- Schema failures from a generated RPC boundary must be mapped back into typed host protocol failures. Malformed `Window.create` output and non-void `Window.close` output now fail as `HostProtocolInvalidOutputError`, and malformed close input fails as `HostProtocolInvalidArgumentError`.

The remaining debt was tracked in #1264 and later removed: host handlers now run through Effect RPC protocol adapters, and `BridgeRpc` is no longer the runtime DSL.
