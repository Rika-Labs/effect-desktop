---
title: NativeFileSystem (native)
description: Native filesystem handle, metadata, and watch boundary.
kind: reference
audience: app-developers
effect_version: 4
---

# `NativeFileSystem`

Declare native filesystem handle, metadata, and watch operations through the
native host boundary.

The Rust host owns permission-checked filesystem handles, metadata reads,
watcher lifecycle, and event delivery on macOS, Windows, and Linux. Native
calls fail with typed host errors; unsupported behavior is not hidden behind a
successful no-op.

`NativeFileSystem` is separate from the core `Filesystem` service. `Filesystem`
owns in-process file policy, canonicalization, reads, writes, and deterministic
test layers. `NativeFileSystem` owns the renderer/native host parity boundary.

## Status

| Method         | Success                              | Runtime support |
| -------------- | ------------------------------------ | --------------- |
| `open`         | `NativeFileSystemOpenResult`         | supported       |
| `stat`         | `NativeFileSystemMetadata`           | supported       |
| `watch`        | `NativeFileSystemWatchResult`        | supported       |
| `stopWatching` | `NativeFileSystemStopWatchingResult` | supported       |
| `isSupported`  | `NativeFileSystemSupportedResult`    | supported       |

## Events

The current event stream is `events()`. Event phases are `watch-started`,
`changed`, `removed`, `failed`, and `watch-stopped`. A successful `watch`
request emits `watch-started` after the native watcher is registered.
Create/modify events are normalized to `changed`, remove events to `removed`,
watch backend failures to `failed`, and `stopWatching` emits `watch-stopped`
after the host drops the watcher.

Events are delivered in native watcher callback order through the host event
channel. The stream has no replay buffer; reconnecting renderers must create a
new watch. If the renderer event channel is gone, the host drops later events
and `stopWatching` remains the explicit cleanup path. Runtime cancellation and
runtime disconnect cleanup drop matching host handles and watchers.

## Validation

Path inputs must be non-empty absolute local paths without control characters or
dot segments. Drive-relative paths, incomplete UNC paths, and traversal-like
paths are rejected before native transport or host filesystem work. Optional
handle, watch, and owner-scope identifiers must be non-empty and must not
contain NUL bytes. Invalid requests fail before host filesystem work.

## Errors

`NativeFileSystemError` is the host protocol error union. Malformed paths or
identifiers return `InvalidArgument`. Host transport failure returns
`HostUnavailable`. Missing paths or unknown watch identifiers return typed
`NotFound`; OS permission errors return typed `PermissionDenied`.

## Related

- Reference: [`Filesystem`](../services/filesystem.md), [`Path`](path.md), [`ScopedAccessGrant`](scoped-access-grant.md)
- Source: [`packages/native/src/native-file-system.ts`](../../../packages/native/src/native-file-system.ts)
