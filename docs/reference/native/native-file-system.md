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

The TypeScript surface is present for contract and bridge-client validation
work, but the Rust host filesystem adapter is not implemented. The native
surface reports `unsupported` on macOS, Windows, and Linux until the host owns
permission-checked filesystem handles, metadata reads, watcher lifecycle, and
event delivery.

`NativeFileSystem` is separate from the core `Filesystem` service. `Filesystem`
owns in-process file policy, canonicalization, reads, writes, and deterministic
test layers. `NativeFileSystem` owns the renderer/native host parity boundary.

## Status

| Method         | Success                              | Runtime support |
| -------------- | ------------------------------------ | --------------- |
| `open`         | `NativeFileSystemOpenResult`         | unsupported     |
| `stat`         | `NativeFileSystemMetadata`           | unsupported     |
| `watch`        | `NativeFileSystemWatchResult`        | unsupported     |
| `stopWatching` | `NativeFileSystemStopWatchingResult` | unsupported     |
| `isSupported`  | `NativeFileSystemSupportedResult`    | unsupported     |

## Events

The current event stream is `events()`. Event phases are `watch-started`,
`changed`, `removed`, `failed`, and `watch-stopped`. Native event delivery is
currently unsupported until the host adapter exists.

Future watch streams must define ordering, terminal events, cancellation
behavior, backpressure policy, and reconnect/replay behavior before claiming
support.

## Validation

Path inputs must be non-empty absolute local paths without control characters or
dot segments. Drive-relative paths, incomplete UNC paths, and traversal-like
paths are rejected before native transport or host filesystem work. Optional
handle, watch, and owner-scope identifiers must be non-empty and must not
contain NUL bytes. Invalid requests fail before host filesystem work.

## Errors

`NativeFileSystemError` is the host protocol error union. Malformed paths or
identifiers return `InvalidArgument`. Host transport failure returns
`HostUnavailable`. Until a platform adapter exists, decoded `NativeFileSystem`
methods fail closed as typed `Unsupported` with reason
`host-adapter-unimplemented`.

## Related

- Reference: [`Filesystem`](../services/filesystem.md), [`Path`](path.md), [`ScopedAccessGrant`](scoped-access-grant.md)
- Source: [`packages/native/src/native-file-system.ts`](../../../packages/native/src/native-file-system.ts)
