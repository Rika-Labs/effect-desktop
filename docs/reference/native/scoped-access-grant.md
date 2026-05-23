---
title: ScopedAccessGrant (native)
description: Product-neutral scoped file and folder access grants with typed fail-closed host behavior.
kind: reference
audience: app-developers
effect_version: 4
---

# `ScopedAccessGrant`

Product-neutral scoped access grant service for future file and directory access grants.

The public service is Layer-first and test-substitutable. The current callable boundary reports support status and exposes typed events. Persistent grant mutation is intentionally absent until the host owns real OS grant material.

## Methods

The surface exposes only the genuinely callable methods below.

| Method        | Payload | Success                       |
| ------------- | ------- | ----------------------------- |
| `isSupported` | `void`  | `{ supported, reason? }`      |
| `events`      | `void`  | stream of scoped grant events |

## Capability facts (non-callable)

`grant`, `resolve`, and `revoke` are **not callable**. They are advertised in the native capability manifest as capability facts with `support.status: "unsupported"`, so callers can discover the intended contract, but the surface does not register them as invocable RPCs.

`grant` remains unsupported as an explicit v1 native capability decision. The
native capability exists to reserve support metadata, not to define a request or
response payload. A real persistent grant must be produced by an OS-mediated
consent mechanism and stored as revalidatable host-owned grant material. The
current host has no macOS security-scoped bookmark adapter, no Windows
access-list or picker-backed grant adapter, no Linux document-portal adapter,
and no grant store tying those platform tokens to `resolve` and `revoke`.

| Capability fact | Status        |
| --------------- | ------------- |
| `grant`         | `unsupported` |
| `resolve`       | `unsupported` |
| `revoke`        | `unsupported` |

## Persistence

Persistent grants will be valid only after host revalidation. `resolve` is currently a non-callable capability fact and has no request or response payload contract.

`resolve` remains unsupported as an explicit v1 native capability decision. A
resolver would need a persisted grant store, platform-specific token decoding,
fresh OS revalidation, and failure semantics for stale or revoked platform
tokens. The current host has none of those pieces, so a routed `resolve` method
would only turn an unsupported capability into a deferred runtime failure.

`revoke` remains unsupported for the same reason. A revoker must own the original
platform grant material: a balanced macOS security-scoped URL access session or
bookmark record, a Windows future-access-list token, or a Linux document-portal
document ID and permission set. The current host does not issue or persist those
tokens, so it cannot prove that `grantId` names a live platform grant or revoke
that grant without risking a false success result.

## Support

The current Rust host adapter is intentionally fail-closed while OS persistent
grant adapters are not implemented. `grant` is kept as a non-callable capability
fact instead of a routed method so callers cannot observe a callable path that
accepts a request and later fails to provide durable access.

| Platform | Status        | Reason                       |
| -------- | ------------- | ---------------------------- |
| macOS    | `unsupported` | `host-adapter-unimplemented` |
| Windows  | `unsupported` | `host-adapter-unimplemented` |
| Linux    | `unsupported` | `host-adapter-unimplemented` |

`isSupported` returns `{ supported: false, reason: "host-adapter-unimplemented" }`. `grant`, `resolve`, and `revoke` are non-callable capability facts published with `support.status: "unsupported"`, not invocable RPCs. The bridge-backed `events` stream also fails typed `Unsupported` before opening a host subscription. The memory client still emits deterministic events for service tests.

## Testing

Use `makeScopedAccessGrantMemoryClient()` for deterministic `isSupported` and event tests without native prompts. Use `makeScopedAccessGrantUnsupportedClient()` when a test needs the typed unsupported path.

## Related

- Source: [`packages/native/src/scoped-access-grant.ts`](../../../packages/native/src/scoped-access-grant.ts)
- Contract: [`packages/native/src/contracts/scoped-access-grant.ts`](../../../packages/native/src/contracts/scoped-access-grant.ts)
