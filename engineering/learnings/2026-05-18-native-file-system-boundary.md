# Native filesystem boundary

Issue: #1370

The core `Filesystem` service already owns in-process filesystem policy:
canonical paths, root checks, symlink and hard-link escape protection, atomic
writes, watch resource cleanup, and memory test layers. That is not the same as
native filesystem parity. Renderer-facing native operations still need a Rust
host boundary before docs and parity can claim host-backed handles, metadata, or
watch streams.

This change adds a dedicated `NativeFileSystem` native boundary:

- `NativeFileSystem.open`
- `NativeFileSystem.stat`
- `NativeFileSystem.watch`
- `NativeFileSystem.stopWatching`
- `NativeFileSystem.isSupported`
- `NativeFileSystem.Event`

The Rust host routes decode and validate payloads first, then fail closed as
typed `Unsupported` with `host-adapter-unimplemented`. That is intentional:
shipping a bridge contract with no host route makes parity invisible, while
returning a successful no-op would hide unsupported filesystem behavior.

Architecture-debt sweep: no wrapper removed. `Filesystem` remains a deep core
module with durable policy and testability. `NativeFileSystem` is not a wrapper
over it; it is the native/web protocol boundary that future platform adapters
must implement. Remaining #1370 work is real host filesystem access, root
enforcement, recursive watchers, event ordering, cleanup on renderer disconnect,
and platform-specific unsupported paths.
