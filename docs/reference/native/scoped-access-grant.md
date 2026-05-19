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

| Method        | Payload                                | Success                                              |
| ------------- | -------------------------------------- | ---------------------------------------------------- |
| `grant`       | `{ actor, scope, grantId?, traceId? }` | `{ grantId, scope, state: "granted" }`               |
| `resolve`     | `{ grantId, traceId? }`                | `{ grantId, scope, state: "resolved", revalidated }` |
| `revoke`      | `{ grantId, traceId? }`                | `{ grantId, revoked }`                               |
| `isSupported` | `void`                                 | `{ supported, reason? }`                             |
| `events`      | `void`                                 | stream of scoped grant events                        |

## Scope

The scope is data:

- `path`
- `kind`: `"file"` or `"directory"`
- `access`: `"read"`, `"write"`, or `"read-write"`

`grant` checks `native.invoke` for `ScopedAccessGrant.grant`. It also checks `filesystem.read` for every grant and `filesystem.write` when `access` is `"write"` or `"read-write"`.

## Persistence

Persistent grants are valid only after host revalidation. `resolve` rejects a host response with `revalidated: false`; callers must treat that as a failed grant recovery, not as access.

## Support

The current Rust host adapter is intentionally fail-closed while OS persistent grant adapters are not implemented.

| Platform | Status        | Reason                       |
| -------- | ------------- | ---------------------------- |
| macOS    | `unsupported` | `host-adapter-unimplemented` |
| Windows  | `unsupported` | `host-adapter-unimplemented` |
| Linux    | `unsupported` | `host-adapter-unimplemented` |

`isSupported` returns `{ supported: false, reason: "host-adapter-unimplemented" }`. Mutating host requests decode and validate payloads, then return typed `Unsupported`; invalid payloads are rejected before the unsupported response. The bridge-backed `events` stream also fails typed `Unsupported` before opening a host subscription. The memory client still emits deterministic events for service tests.

## Testing

Use `makeScopedAccessGrantMemoryClient()` for deterministic grant, resolve, revoke, and event tests without native prompts. Use `makeScopedAccessGrantUnsupportedClient()` when a test needs the typed unsupported path.

## Related

- Source: [`packages/native/src/scoped-access-grant.ts`](../../../packages/native/src/scoped-access-grant.ts)
- Contract: [`packages/native/src/contracts/scoped-access-grant.ts`](../../../packages/native/src/contracts/scoped-access-grant.ts)
