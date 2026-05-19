---
title: CookieStore (native)
description: Typed cookie reads, writes, removals, and change events scoped to SessionProfile handles.
kind: reference
audience: app-developers
effect_version: 4
---

# `CookieStore`

`CookieStore` exposes cookie read, write, remove, and event operations scoped to an explicit `SessionProfileHandle`. The profile handle is the partition identity; cookie calls do not use global browser state in the public contract.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport, checks `native.invoke` permissions before client side effects, and exposes `CookieStore.Event` as a typed stream. The memory client proves partition isolation by storing cookies under `profile.id`.

## Methods

| Method        | Payload                         | Success                  |
| ------------- | ------------------------------- | ------------------------ |
| `get`         | `{ profile, url, name? }`       | `{ cookies }`            |
| `set`         | `{ profile, url, cookie }`      | `void`                   |
| `remove`      | `{ profile, url, name }`        | `void`                   |
| `isSupported` | `void`                          | `{ supported, reason? }` |
| `events`      | optional `SessionProfileHandle` | stream of events         |

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

`url` must be absolute `http` or `https`. Cookie paths must start with `/`.

## Support

The Rust host routes the methods and validates payloads, but it does not yet bind `SessionProfileHandle` to Wry `WebContext` cookie stores. Host requests therefore fail closed with typed `Unsupported` after validation.

| Platform | Status        | Reason                          |
| -------- | ------------- | ------------------------------- |
| macOS    | `unsupported` | `host-cookie-store-unavailable` |
| Windows  | `unsupported` | `host-cookie-store-unavailable` |
| Linux    | `unsupported` | `host-cookie-store-unavailable` |

`isSupported` returns `{ supported: false, reason: "host-cookie-store-unavailable" }` from the host. Use `makeCookieStoreMemoryClient()` for deterministic success and event tests; use `makeCookieStoreUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/cookie-store.ts`](../../../packages/native/src/cookie-store.ts)
- Contract: [`packages/native/src/contracts/cookie-store.ts`](../../../packages/native/src/contracts/cookie-store.ts)
