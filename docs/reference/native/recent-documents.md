---
title: RecentDocuments (native)
description: OS recent-document list boundary.
kind: reference
audience: app-developers
effect_version: 4
---

# `RecentDocuments`

Declare OS-level recent-document operations through the native host boundary.

The TypeScript surface is present for contract and bridge-client validation
work, but the Rust host RecentDocuments adapter is not implemented. The native
surface reports `unsupported` on macOS, Windows, and Linux until the host owns
platform-specific recent-document APIs.

## Status

| Method  | Success                     | Runtime support |
| ------- | --------------------------- | --------------- |
| `add`   | `void`                      | unsupported     |
| `clear` | `void`                      | unsupported     |
| `list`  | `RecentDocumentsListResult` | unsupported     |

## Events

The current event stream is `events()`. Event phases are `document-added`,
`cleared`, and `failed`. Native event delivery is currently unsupported until
the host adapter exists.

## Validation

`add.path` must be a non-empty absolute platform path with no Unicode control
characters and no `.` or `..` path segments. Relative paths, drive-relative
Windows paths, and incomplete UNC roots are rejected before native transport.

## Errors

`RecentDocumentsError` is the host protocol error union. Malformed paths return
`InvalidArgument`. Host transport failure returns `HostUnavailable`. Until a
platform adapter exists, decoded RecentDocuments methods fail closed as typed
`Unsupported` with reason `host-adapter-unimplemented`.

## Related

- Reference: [`App`](app.md), [`Path`](path.md)
- Source: [`packages/native/src/recent-documents.ts`](../../../packages/native/src/recent-documents.ts)
