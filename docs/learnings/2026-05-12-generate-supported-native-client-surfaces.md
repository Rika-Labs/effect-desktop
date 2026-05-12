# Generate supported native client surfaces

Issue #1179 made support metadata part of generated client shape, not just documentation. `WindowRpcs` now remains the full descriptor contract, while `WindowSupportedRpcs` filters the callable generated client to host-backed methods.

The useful boundary was: unsupported planned methods stay in `RpcSupport` metadata, schema docs, and host compatibility handlers, but they are not methods on `WindowClientApi`, React Window helpers, or test clients. That prevents descriptor-only operations from looking like ordinary successful service methods.

The generated Window client exposed two adapter rules worth keeping:

- Effect RPC success schemas must be real schemas. Bridge resource specs can still exist for compatibility metadata, but generated `RpcClient` paths need schema-backed payloads.
- Schema failures from a generated RPC boundary must be mapped back into typed host protocol failures. Malformed `Window.create` output and non-void `Window.close` output now fail as `HostProtocolInvalidOutputError`, and malformed close input fails as `HostProtocolInvalidArgumentError`.

The remaining debt is already tracked in #1264: remove `BridgeRpc` as a runtime DSL once host handlers can run directly through Effect RPC protocol adapters.
