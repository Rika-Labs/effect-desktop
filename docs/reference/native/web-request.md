---
title: WebRequest (native)
description: Ordered request and response interception scoped to SessionProfile handles.
kind: reference
audience: app-developers
effect_version: 4
---

# `WebRequest`

`WebRequest` declares the typed interception surface for ordered request and response interceptors scoped to a `SessionProfileHandle` — blocking requests, redirecting requests, modifying response headers, and observing interceptor lifecycle events.

The public service is Layer-first and test-substitutable. The TypeScript service checks `native.invoke` permissions before client side effects and exposes `WebRequest.Event` as a typed stream. The memory client proves the support query and event paths without renderer monkeypatching.

## Methods

The only callable RPC on this surface is the support query:

| Method        | Payload                         | Success                  |
| ------------- | ------------------------------- | ------------------------ |
| `isSupported` | `void`                          | `{ supported, reason? }` |
| `events`      | optional `SessionProfileHandle` | stream of events         |

`events(profile?)` emits `registered` and `removed` lifecycle events with order, request phase, action, URL pattern, profile, and interceptor handle.

## Capability facts (non-callable)

`onBeforeRequest`, `onHeadersReceived`, and `removeListener` are not callable RPCs. They are advertised in the native capability manifest as capability facts with `support.status: "unsupported"` and reason `host-web-request-unavailable`, but no host adapter can be invoked. They describe the intended interception contract until profile-bound WebViews can route provider request and response callbacks.

| Capability fact     | Intended role                                                               |
| ------------------- | --------------------------------------------------------------------------- |
| `onBeforeRequest`   | Register a request interceptor with action `allow`, `block`, or `redirect`. |
| `onHeadersReceived` | Register a response header mutation policy (`modify-headers`).              |
| `removeListener`    | Remove a previously registered interceptor.                                 |

## Support

The Rust host does not yet receive portable request or response interception callbacks from profile-bound WebViews, so the interception methods are demoted to non-callable capability facts.

| Platform | Status        | Reason                         |
| -------- | ------------- | ------------------------------ |
| macOS    | `unsupported` | `host-web-request-unavailable` |
| Windows  | `unsupported` | `host-web-request-unavailable` |
| Linux    | `unsupported` | `host-web-request-unavailable` |

`isSupported` returns `{ supported: false, reason: "host-web-request-unavailable" }` from the host. Use `makeWebRequestMemoryClient()` for deterministic support-query tests; use `makeWebRequestUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/web-request.ts`](../../../packages/native/src/web-request.ts)
- Contract: [`packages/native/src/contracts/web-request.ts`](../../../packages/native/src/contracts/web-request.ts)
