---
title: SessionProfile (native)
description: Explicit browser session/profile handles for partitioned WebView state.
kind: reference
audience: app-developers
effect_version: 4
---

# `SessionProfile`

`SessionProfile` declares explicit handles for browser session/profile state. A profile is keyed by a caller-provided partition string and is represented as a `session-profile` resource handle so cookies, cache, permissions, storage, downloads, and request APIs can later depend on one typed identity instead of global browser state.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport, checks `native.invoke` permissions before client side effects, registers opened profiles in `ResourceRegistry`, and calls `destroy` when the owning resource scope closes.

## Methods

| Method          | Payload                                | Success                                |
| --------------- | -------------------------------------- | -------------------------------------- |
| `fromPartition` | `{ partition, ownerScope?, traceId? }` | `SessionProfileHandle`                 |
| `destroy`       | `{ profile, traceId? }`                | `void`                                 |
| `list`          | `void`                                 | `{ profiles: SessionProfileHandle[] }` |
| `isSupported`   | `void`                                 | `{ supported, reason? }`               |
| `events`        | `void`                                 | stream of session profile events       |

## Lifecycle

`fromPartition` is idempotent for an active partition inside the public service. The returned handle has:

- `kind: "session-profile"`
- `state: "open"`
- `id: "session-profile:<partition>"`
- `ownerScope`: the supplied scope, or `"app"`

The service registers that handle with `ResourceRegistry` before returning it. Closing the owner scope runs the registered cleanup finalizer, which calls `SessionProfile.destroy` for the same handle.

## Support

The Rust host routes the methods and validates payloads, but it does not yet connect these handles to Wry `WebContext` data directories or WebView creation. Mutating host requests therefore fail closed with typed `Unsupported` after validation.

| Platform | Status        | Reason                                     |
| -------- | ------------- | ------------------------------------------ |
| macOS    | `unsupported` | `host-session-profile-routing-unavailable` |
| Windows  | `unsupported` | `host-session-profile-routing-unavailable` |
| Linux    | `unsupported` | `host-session-profile-routing-unavailable` |

`isSupported` returns `{ supported: false, reason: "host-session-profile-routing-unavailable" }` from the host. The memory client supports deterministic success, denial, unsupported, host failure, event, and cleanup tests without native browser state.

## Related

- Source: [`packages/native/src/session-profile.ts`](../../../packages/native/src/session-profile.ts)
- Contract: [`packages/native/src/contracts/session-profile.ts`](../../../packages/native/src/contracts/session-profile.ts)
