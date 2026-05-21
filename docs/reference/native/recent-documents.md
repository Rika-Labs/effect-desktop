---
title: RecentDocuments (native)
description: OS recent-document list boundary.
kind: reference
audience: app-developers
effect_version: 4
---

# `RecentDocuments`

Declare OS-level recent-document operations through the native host boundary.

The Rust host adapter adds and clears recent documents on macOS through
`NSDocumentController`, on Windows through `SHAddToRecentDocs`, and on Linux
through GTK `RecentManager`. `list` remains macOS-only until platform-specific
adapters exist.

## Status

| Method  | Success                     | Runtime support                 |
| ------- | --------------------------- | ------------------------------- |
| `add`   | `void`                      | macOS, Windows, Linux supported |
| `clear` | `void`                      | macOS, Windows, Linux supported |
| `list`  | `RecentDocumentsListResult` | macOS supported                 |

## Events

The current event stream is `events()`. Event phases are `document-added`,
`cleared`, and `failed`. The host emits `document-added` after a successful
macOS `add` and `cleared` after a successful macOS `clear`.

## Validation

`add.path` must be a non-empty absolute platform path with no Unicode control
characters and no `.` or `..` path segments. Relative paths, drive-relative
Windows paths, and incomplete UNC roots are rejected before native transport.

## Errors

`RecentDocumentsError` is the host protocol error union. Malformed paths return
`InvalidArgument`. Host transport failure returns `HostUnavailable`. On
Windows and Linux, decoded `list` fails closed as typed `Unsupported` with
reason `host-adapter-unimplemented`.

## Related

- Reference: [`App`](app.md), [`Path`](path.md)
- Source: [`packages/native/src/recent-documents.ts`](../../../packages/native/src/recent-documents.ts)
