---
title: CookieStore (native)
description: Typed cookie reads, writes, removals, and change events scoped to SessionProfile handles.
kind: reference
audience: app-developers
effect_version: 4
---

# `CookieStore`

`CookieStore` describes cookie read, write, remove, and event operations scoped to an explicit `SessionProfileHandle`. The profile handle is the partition identity; cookie calls do not use global browser state in the public contract. `get`, `set`, and `remove` are routed native RPCs backed by Wry's WebView cookie API.

The public service is Layer-first and test-substitutable. The TypeScript service exposes `CookieStore.events.Event` as a typed RPC stream; bridge clients keep host wire compatibility by subscribing to `CookieStore.Event`.

## Methods

| Method        | Payload                         | Success                  |
| ------------- | ------------------------------- | ------------------------ |
| `get`         | `{ profile, url, name? }`       | `{ cookies }`            |
| `set`         | `{ profile, url, cookie }`      | `void`                   |
| `remove`      | `{ profile, url, name }`        | `void`                   |
| `isSupported` | `void`                          | `{ supported, reason? }` |
| `events`      | optional `SessionProfileHandle` | stream of events         |

## Capability facts (non-callable)

`CookieStore` currently has no non-callable capability facts. Cookie read, write, remove, and support checks are callable RPCs.

`url` must be absolute `http` or `https` and cookie paths must start with `/`.

`events(profile?)` consumes `CookieStore.events.Event` and filters by profile when one is supplied. Successful `set` calls emit phase `"set"` with the cookie payload. Successful `remove` calls emit phase `"removed"` when the host deletes a matching cookie name. Failed cookie operations emit phase `"failed"` carrying a `message` string. `get` does not emit events. Consumers of `events(profile?)` should handle all three phases (`set`, `removed`, `failed`).

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

`get`, `set`, and `remove` are routed through the Rust host and operate on cookies from a live Wry WebView bound to the requested `SessionProfileHandle`. Wry 0.55.1 exposes cookie reads, writes, and deletion on `WebView`, not `WebContext`; if the profile is live but has no live WebView, the host fails the operation with `Unsupported { reason: "host-cookie-store-live-webview-required" }` rather than pretending the profile cookie store is available.

| Platform | Status    | Reason                                    |
| -------- | --------- | ----------------------------------------- |
| macOS    | `partial` | `host-cookie-store-live-webview-required` |
| Windows  | `partial` | `host-cookie-store-live-webview-required` |
| Linux    | `partial` | `host-cookie-store-live-webview-required` |

`isSupported` returns `{ supported: true }` from the host. Use `makeCookieStoreMemoryClient()` for deterministic success tests; use `makeCookieStoreUnsupportedClient()` for the typed unsupported path.

Architecture-debt sweep outcome for #1862: removed `CookieStoreRpcEvents` and the empty `CookieStoreCapabilityFacts` export. The `CookieStore` service remains because it is the single test-substitutable boundary for typed cookie operations and profile-filtered event streams.

## Related

- Source: [`packages/native/src/cookie-store.ts`](../../../packages/native/src/cookie-store.ts)
- Contract: [`packages/native/src/contracts/cookie-store.ts`](../../../packages/native/src/contracts/cookie-store.ts)
