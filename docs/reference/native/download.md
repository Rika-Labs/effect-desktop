---
title: Download (native)
description: Typed download lifecycle controls scoped to SessionProfile handles.
kind: reference
audience: app-developers
effect_version: 4
---

# `Download`

`Download` declares profile-owned download start, pause, resume, cancel, list, and event operations. Each started download returns a generation-stamped `download` resource handle registered with `ResourceRegistry`; closing the owner scope cancels the native download once.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport, checks `native.invoke` permissions before client side effects, and exposes `Download.Event` as a typed stream. The memory client records snapshots under download handles and emits ordered replayable events, including terminal `canceled` events for interrupted downloads.

## Methods

| Method        | Payload                          | Success                  |
| ------------- | -------------------------------- | ------------------------ |
| `start`       | `{ profile, url, destination? }` | download snapshot        |
| `pause`       | `{ download }`                   | download snapshot        |
| `resume`      | `{ download }`                   | download snapshot        |
| `cancel`      | `{ download }`                   | download snapshot        |
| `list`        | `{ profile? }`                   | `{ downloads }`          |
| `isSupported` | `void`                           | `{ supported, reason? }` |
| `events`      | optional download handle         | stream of events         |

`url` must be absolute `http` or `https`. `destination` must be non-empty and must not contain parent traversal segments.

## Support

The Rust host routes the methods and validates payloads, but it does not yet receive portable provider download callbacks from profile-bound WebViews. Host requests therefore fail closed with typed `Unsupported` after validation.

| Platform | Status        | Reason                      |
| -------- | ------------- | --------------------------- |
| macOS    | `unsupported` | `host-download-unavailable` |
| Windows  | `unsupported` | `host-download-unavailable` |
| Linux    | `unsupported` | `host-download-unavailable` |

`isSupported` returns `{ supported: false, reason: "host-download-unavailable" }` from the host. Use `makeDownloadMemoryClient()` for deterministic lifecycle and cleanup tests; use `makeDownloadUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/download.ts`](../../../packages/native/src/download.ts)
- Contract: [`packages/native/src/contracts/download.ts`](../../../packages/native/src/contracts/download.ts)
