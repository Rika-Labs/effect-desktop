---
title: CookieStore (native)
description: Typed cookie reads, writes, removals, and change events scoped to SessionProfile handles.
kind: reference
audience: app-developers
effect_version: 4
---

# `CookieStore`

`CookieStore` describes cookie read, write, remove, and event operations scoped to an explicit `SessionProfileHandle`. The profile handle is the partition identity; cookie calls do not use global browser state in the public contract. `get` and `remove` are routed native RPCs backed by Wry's WebView cookie API. `set` remains a non-callable capability fact in this build.

The public service is Layer-first and test-substitutable. The TypeScript service exposes `CookieStore.Event` as a typed stream.

## Methods

| Method        | Payload                         | Success                  |
| ------------- | ------------------------------- | ------------------------ |
| `get`         | `{ profile, url, name? }`       | `{ cookies }`            |
| `remove`      | `{ profile, url, name }`        | `void`                   |
| `isSupported` | `void`                          | `{ supported, reason? }` |
| `events`      | optional `SessionProfileHandle` | stream of events         |

## Capability facts (non-callable)

`set` is advertised in the native capability manifest as a capability fact with `support.status: "unsupported"` (reason `host-cookie-store-unavailable`). It is not an invocable RPC: the surface registers no handler or client method for it. It exists only so the manifest can describe the intended cookie write operation and so permission tooling can reason about the `native.invoke` authority it would require.

`url` must be absolute `http` or `https` and cookie paths must start with `/`.

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

`get` and `remove` are routed through the Rust host and operate on cookies from a live Wry WebView bound to the requested `SessionProfileHandle`. Wry 0.55.1 exposes cookie reads and deletion on `WebView`, not `WebContext`; if the profile is live but has no live WebView, the host fails the operation with `Unsupported { reason: "host-cookie-store-live-webview-required" }` rather than pretending the profile cookie store is available.

| Platform | Status    | Reason                                    |
| -------- | --------- | ----------------------------------------- |
| macOS    | `partial` | `host-cookie-store-live-webview-required` |
| Windows  | `partial` | `host-cookie-store-live-webview-required` |
| Linux    | `partial` | `host-cookie-store-live-webview-required` |

`isSupported` returns `{ supported: true }` from the host. Use `makeCookieStoreMemoryClient()` for deterministic success and event tests; use `makeCookieStoreUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/cookie-store.ts`](../../../packages/native/src/cookie-store.ts)
- Contract: [`packages/native/src/contracts/cookie-store.ts`](../../../packages/native/src/contracts/cookie-store.ts)
