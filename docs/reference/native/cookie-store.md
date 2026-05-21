---
title: CookieStore (native)
description: Typed cookie reads, writes, removals, and change events scoped to SessionProfile handles.
kind: reference
audience: app-developers
effect_version: 4
---

# `CookieStore`

`CookieStore` describes cookie read, write, remove, and event operations scoped to an explicit `SessionProfileHandle`. The profile handle is the partition identity; cookie calls do not use global browser state in the public contract. `get` is a routed native RPC backed by Wry's WebView cookie API. `set` and `remove` remain non-callable capability facts in this build.

The public service is Layer-first and test-substitutable. The TypeScript service exposes `CookieStore.Event` as a typed stream.

## Methods

| Method        | Payload                         | Success                  |
| ------------- | ------------------------------- | ------------------------ |
| `get`         | `{ profile, url, name? }`       | `{ cookies }`            |
| `isSupported` | `void`                          | `{ supported, reason? }` |
| `events`      | optional `SessionProfileHandle` | stream of events         |

## Capability facts (non-callable)

`set` and `remove` are advertised in the native capability manifest as capability facts with `support.status: "unsupported"` (reason `host-cookie-store-unavailable`). They are not invocable RPCs: the surface registers no handlers or client methods for them. They exist only so the manifest can describe the intended cookie write and remove operations and so permission tooling can reason about the `native.invoke` authority they would require.

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

`get` is routed through the Rust host and returns cookies from a live Wry WebView bound to the requested `SessionProfileHandle`. Wry 0.55.1 exposes cookie reads on `WebView`, not `WebContext`; if the profile is live but has no live WebView, the host fails `get` with `Unsupported { reason: "host-cookie-store-live-webview-required" }` rather than pretending the store is empty.

| Platform | Status    | Reason                                    |
| -------- | --------- | ----------------------------------------- |
| macOS    | `partial` | `host-cookie-store-live-webview-required` |
| Windows  | `partial` | `host-cookie-store-live-webview-required` |
| Linux    | `partial` | `host-cookie-store-live-webview-required` |

`isSupported` returns `{ supported: true }` from the host. Use `makeCookieStoreMemoryClient()` for deterministic success and event tests; use `makeCookieStoreUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/cookie-store.ts`](../../../packages/native/src/cookie-store.ts)
- Contract: [`packages/native/src/contracts/cookie-store.ts`](../../../packages/native/src/contracts/cookie-store.ts)
