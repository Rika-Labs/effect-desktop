# Notes Common

Shared contract and runtime spine for the cross-framework Notes examples.

The package owns the `NotesRpcs` `RpcGroup`, the `NotesApp` desktop manifest, the service-backed host layer, and the `RpcTest` demo layers used by browser examples. Framework examples import this package instead of redefining RPCs locally.

## Dependency Note

This example package depends only on first-party workspace packages and `effect@4.0.0-beta.60`. Framework-specific browser dependencies live in each renderer example package.
