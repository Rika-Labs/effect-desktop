# Native filesystem path guard

## Context

`NativeFileSystem` is the host boundary for future native file handles, metadata, and watchers. The adapter is still fail-closed, but renderer inputs already cross the Schema/bridge boundary and must not preserve ambiguous paths that a future host adapter would need to reinterpret.

## Change

`NativeFileSystem` now requires open/stat/watch paths and host-returned metadata/event paths to be absolute platform paths without control characters or dot segments. The Rust host route applies the same guard before returning typed `Unsupported`.

## Verification

- `bun test packages/native/src/index.test.ts -t NativeFileSystem`
- `cargo test -p host native_file_system --bin host`
- `cargo fmt --check`
- `git diff --check`

## Architecture-debt sweep

No wrapper was removed. `NativeFileSystem` remains a native/web boundary distinct from core `Filesystem`, which owns in-process file policy and test layers. The remaining debt is still the missing host adapter for filesystem handles, declared-root enforcement, watcher lifecycle, event ordering, renderer-disconnect cleanup, and real native smoke coverage.
