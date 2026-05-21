---
title: SessionProfile (native)
description: Explicit browser session/profile handles for partitioned WebView state.
kind: reference
audience: app-developers
effect_version: 4
---

# `SessionProfile`

`SessionProfile` declares explicit handles for browser session/profile state. A profile is keyed by a caller-provided partition string and is represented as a `session-profile` resource handle so cookies, cache, permissions, storage, downloads, and request APIs can later depend on one typed identity instead of global browser state.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport and checks `native.invoke` permissions before client side effects. The profile-management methods are callable RPCs backed by the Rust host profile registry.

## Methods

| Method          | Payload                                | Success                          |
| --------------- | -------------------------------------- | -------------------------------- |
| `fromPartition` | `{ partition, ownerScope?, traceId? }` | `session-profile` handle         |
| `destroy`       | `{ profile, traceId? }`                | `void`                           |
| `list`          | `void`                                 | `{ profiles }`                   |
| `isSupported`   | `void`                                 | `{ supported, reason? }`         |
| `events`        | `void`                                 | stream of session profile events |

## Lifecycle

`fromPartition` is idempotent for an active partition inside the host, returning a handle with:

- `kind: "session-profile"`
- `state: "open"`
- `id: "session-profile:<partition>"`
- `ownerScope`: the supplied scope, or `"app"`

The host validates live handles on `destroy`, `list`, `WebView.create`, and profile-scoped browsing-data operations.

## Support

The host connects profile handles to Wry `WebContext` data directories for child WebViews created with a `profile` handle.

| Platform | Status      |
| -------- | ----------- |
| macOS    | `supported` |
| Windows  | `supported` |
| Linux    | `supported` |

`isSupported` returns `{ supported: true }` from the host. The memory client supports deterministic lifecycle and event tests without native browser state.

## Related

- Source: [`packages/native/src/session-profile.ts`](../../../packages/native/src/session-profile.ts)
- Contract: [`packages/native/src/contracts/session-profile.ts`](../../../packages/native/src/contracts/session-profile.ts)
