---
title: SessionProfile (native)
description: Explicit browser session/profile handles for partitioned WebView state.
kind: reference
audience: app-developers
effect_version: 4
---

# `SessionProfile`

`SessionProfile` declares explicit handles for browser session/profile state. A profile is keyed by a caller-provided partition string and is represented as a `session-profile` resource handle so cookies, cache, permissions, storage, downloads, and request APIs can later depend on one typed identity instead of global browser state.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport and checks `native.invoke` permissions before client side effects. The profile-management methods (`fromPartition`, `destroy`, `list`) are currently non-callable capability facts; only `isSupported` and the event stream are invocable.

## Methods

The surface exposes only the genuinely callable methods below.

| Method        | Payload | Success                          |
| ------------- | ------- | -------------------------------- |
| `isSupported` | `void`  | `{ supported, reason? }`         |
| `events`      | `void`  | stream of session profile events |

## Capability facts (non-callable)

`fromPartition`, `destroy`, and `list` are **not callable**. They are advertised in the native capability manifest as capability facts with `support.status: "unsupported"`, so callers can discover the intended contract, but the surface does not register them as invocable RPCs.

| Capability fact | Intended payload                       | Status        |
| --------------- | -------------------------------------- | ------------- |
| `fromPartition` | `{ partition, ownerScope?, traceId? }` | `unsupported` |
| `destroy`       | `{ profile, traceId? }`                | `unsupported` |
| `list`          | `void`                                 | `unsupported` |

## Lifecycle

The `fromPartition` capability fact's intended contract is idempotent for an active partition inside the public service, returning a handle with:

- `kind: "session-profile"`
- `state: "open"`
- `id: "session-profile:<partition>"`
- `ownerScope`: the supplied scope, or `"app"`

The intended contract registers that handle with `ResourceRegistry` before returning it, and closing the owner scope runs a cleanup finalizer that calls `SessionProfile.destroy` for the same handle. This describes the intended contract; `fromPartition` and `destroy` cannot currently be invoked.

## Support

The host does not yet connect these handles to Wry `WebContext` data directories or WebView creation. Because those methods are not implemented, they are published as non-callable capability facts with `support.status: "unsupported"` rather than registered as invocable RPCs.

| Platform | Status        | Reason                                     |
| -------- | ------------- | ------------------------------------------ |
| macOS    | `unsupported` | `host-session-profile-routing-unavailable` |
| Windows  | `unsupported` | `host-session-profile-routing-unavailable` |
| Linux    | `unsupported` | `host-session-profile-routing-unavailable` |

`isSupported` returns `{ supported: false, reason: "host-session-profile-routing-unavailable" }` from the host. The memory client supports deterministic `isSupported` and event tests without native browser state.

## Related

- Source: [`packages/native/src/session-profile.ts`](../../../packages/native/src/session-profile.ts)
- Contract: [`packages/native/src/contracts/session-profile.ts`](../../../packages/native/src/contracts/session-profile.ts)
