---
title: ScopedAccessGrant (native)
description: Product-neutral scoped file and folder access grants with typed fail-closed host behavior.
kind: reference
audience: app-developers
effect_version: 4
---

# `ScopedAccessGrant`

Product-neutral scoped access grant service for file and directory access. Callers ask for a narrow path scope, resolve that grant after restart only when the host revalidates it, and revoke it when the scope is no longer needed.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport, checks declared native and filesystem permissions before privileged work, emits typed events, and records audit rows for privileged use and denial.

## Methods

The surface exposes only the genuinely callable methods below.

| Method        | Payload | Success                       |
| ------------- | ------- | ----------------------------- |
| `isSupported` | `void`  | `{ supported, reason? }`      |
| `events`      | `void`  | stream of scoped grant events |

## Capability facts (non-callable)

`grant`, `resolve`, and `revoke` are **not callable**. They are advertised in the native capability manifest as capability facts with `support.status: "unsupported"`, so callers can discover the intended contract, but the surface does not register them as invocable RPCs.

`grant` remains unsupported as an explicit v1 native capability decision. The
request shape names an arbitrary path, actor, and access mode, but a real
persistent grant must be produced by an OS-mediated consent mechanism and stored
as revalidatable host-owned grant material. The current host has no macOS
security-scoped bookmark adapter, no Windows access-list or picker-backed grant
adapter, no Linux document-portal adapter, and no grant store tying those
platform tokens to `resolve` and `revoke`.

| Capability fact | Intended payload                       | Status        |
| --------------- | -------------------------------------- | ------------- |
| `grant`         | `{ actor, scope, grantId?, traceId? }` | `unsupported` |
| `resolve`       | `{ grantId, traceId? }`                | `unsupported` |
| `revoke`        | `{ grantId, traceId? }`                | `unsupported` |

## Scope

The scope is data:

- `path`
- `kind`: `"file"` or `"directory"`
- `access`: `"read"`, `"write"`, or `"read-write"`

The `grant` capability fact declares `native.invoke` authority for `ScopedAccessGrant.grant`. Its intended contract also checks `filesystem.read` for every grant and `filesystem.write` when `access` is `"write"` or `"read-write"`. These constraints describe the intended contract; the method cannot currently be invoked.

## Persistence

Persistent grants are valid only after host revalidation. The `resolve` capability fact's intended contract rejects a host response with `revalidated: false`; callers must treat that as a failed grant recovery, not as access. `resolve` is currently a non-callable capability fact.

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
