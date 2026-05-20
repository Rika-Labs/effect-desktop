---
title: Download (native)
description: Typed download lifecycle controls scoped to SessionProfile handles.
kind: reference
audience: app-developers
effect_version: 4
---

# `Download`

`Download` describes profile-owned download lifecycle and event operations. The download start, pause, resume, cancel, and list operations are declared as capability facts but are not callable in this build; `isSupported` and the `Download.Event` stream are the genuinely callable surface.

The public service is Layer-first and test-substitutable. The TypeScript service exposes `Download.Event` as a typed stream. The memory client records snapshots under download handles and emits ordered replayable events, including terminal `canceled` events for interrupted downloads.

## Methods

| Method        | Payload                  | Success                  |
| ------------- | ------------------------ | ------------------------ |
| `isSupported` | `void`                   | `{ supported, reason? }` |
| `events`      | optional download handle | stream of events         |

## Capability facts (non-callable)

`start`, `pause`, `resume`, `cancel`, and `list` are advertised in the native capability manifest as capability facts with `support.status: "unsupported"` (reason `host-download-unavailable`). They are not invocable RPCs: the surface registers no handlers or client methods for them. They exist only so the manifest can describe the intended profile-owned download lifecycle and so permission tooling can reason about the `native.invoke` authority they would require.

When download support lands, `start` accepts `{ profile, url, destination? }` where `url` must be absolute `http` or `https` and `destination` must be non-empty without parent traversal segments; `pause`, `resume`, and `cancel` take `{ download }`; `list` takes `{ profile? }`. Each started download would return a generation-stamped `download` resource handle registered with `ResourceRegistry`.

## Support

The host does not yet receive portable provider download callbacks from profile-bound WebViews, so the lifecycle methods are demoted to non-callable capability facts rather than routed RPCs.

| Platform | Status        | Reason                      |
| -------- | ------------- | --------------------------- |
| macOS    | `unsupported` | `host-download-unavailable` |
| Windows  | `unsupported` | `host-download-unavailable` |
| Linux    | `unsupported` | `host-download-unavailable` |

`isSupported` returns `{ supported: false, reason: "host-download-unavailable" }` from the host. Use `makeDownloadMemoryClient()` for deterministic lifecycle and cleanup tests; use `makeDownloadUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/download.ts`](../../../packages/native/src/download.ts)
- Contract: [`packages/native/src/contracts/download.ts`](../../../packages/native/src/contracts/download.ts)
