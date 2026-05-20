---
title: CookieStore (native)
description: Typed cookie reads, writes, removals, and change events scoped to SessionProfile handles.
kind: reference
audience: app-developers
effect_version: 4
---

# `CookieStore`

`CookieStore` describes cookie read, write, remove, and event operations scoped to an explicit `SessionProfileHandle`. The profile handle is the partition identity; cookie calls do not use global browser state in the public contract. The get, set, and remove operations are declared as capability facts but are not callable in this build; `isSupported` and the `CookieStore.Event` stream are the genuinely callable surface.

The public service is Layer-first and test-substitutable. The TypeScript service exposes `CookieStore.Event` as a typed stream. The memory client proves partition isolation by storing cookies under `profile.id`.

## Methods

| Method        | Payload                         | Success                  |
| ------------- | ------------------------------- | ------------------------ |
| `isSupported` | `void`                          | `{ supported, reason? }` |
| `events`      | optional `SessionProfileHandle` | stream of events         |

## Capability facts (non-callable)

`get`, `set`, and `remove` are advertised in the native capability manifest as capability facts with `support.status: "unsupported"` (reason `host-cookie-store-unavailable`). They are not invocable RPCs: the surface registers no handlers or client methods for them. They exist only so the manifest can describe the intended cookie read, write, and remove operations and so permission tooling can reason about the `native.invoke` authority they would require.

When cookie-store support lands, `get` would accept `{ profile, url, name? }` and return `{ cookies }`, `set` would accept `{ profile, url, cookie }`, and `remove` would accept `{ profile, url, name }`. `url` must be absolute `http` or `https` and cookie paths must start with `/`.

## Cookie Shape

Cookies are plain data:

- `name`
- `value`
- `domain`
- `path`
- optional `secure`
- optional `httpOnly`
- optional `sameSite`: `"lax"`, `"strict"`, or `"none"`
- optional `expiresAt`

## Support

The host does not yet bind `SessionProfileHandle` to Wry `WebContext` cookie stores, so the get, set, and remove methods are demoted to non-callable capability facts rather than routed RPCs.

| Platform | Status        | Reason                          |
| -------- | ------------- | ------------------------------- |
| macOS    | `unsupported` | `host-cookie-store-unavailable` |
| Windows  | `unsupported` | `host-cookie-store-unavailable` |
| Linux    | `unsupported` | `host-cookie-store-unavailable` |

`isSupported` returns `{ supported: false, reason: "host-cookie-store-unavailable" }` from the host. Use `makeCookieStoreMemoryClient()` for deterministic success and event tests; use `makeCookieStoreUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/cookie-store.ts`](../../../packages/native/src/cookie-store.ts)
- Contract: [`packages/native/src/contracts/cookie-store.ts`](../../../packages/native/src/contracts/cookie-store.ts)
