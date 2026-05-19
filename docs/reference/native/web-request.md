---
title: WebRequest (native)
description: Ordered request and response interception scoped to SessionProfile handles.
kind: reference
audience: app-developers
effect_version: 4
---

# `WebRequest`

`WebRequest` declares ordered request and response interceptors scoped to a `SessionProfileHandle`. It is the typed interception surface for blocking requests, redirecting requests, modifying response headers, and observing interceptor lifecycle events.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport or resource registration, checks `native.invoke` permissions before client side effects, registers long-lived interceptors with `ResourceRegistry`, and exposes `WebRequest.Event` as a typed stream. The memory client proves ordered success, denial, unsupported, host failure, malformed input rejection, and resource cleanup without renderer monkeypatching.

## Methods

| Method              | Payload                                    | Success                  |
| ------------------- | ------------------------------------------ | ------------------------ |
| `onBeforeRequest`   | `{ profile, urlPattern, action, ... }`     | interceptor snapshot     |
| `onHeadersReceived` | `{ profile, urlPattern, responseHeaders }` | interceptor snapshot     |
| `removeListener`    | `{ interceptor }`                          | `void`                   |
| `isSupported`       | `void`                                     | `{ supported, reason? }` |
| `events`            | optional `SessionProfileHandle`            | stream of events         |

`onBeforeRequest` actions are `allow`, `block`, and `redirect`. Redirect actions require an absolute HTTP(S) `redirectUrl`; non-redirect actions must omit it. `onHeadersReceived` registers header mutation policy and returns snapshots with action `modify-headers`.

Interceptor snapshots include `order`; lower order values run first. `events(profile?)` emits `registered` and `removed` lifecycle events with the same order, request phase, action, URL pattern, profile, and interceptor handle. Closing the owner scope releases registered interceptors.

## Support

The Rust host routes the methods and validates payloads, but it does not yet receive portable request or response interception callbacks from profile-bound WebViews. Host requests therefore fail closed with typed `Unsupported` after validation.

| Platform | Status        | Reason                         |
| -------- | ------------- | ------------------------------ |
| macOS    | `unsupported` | `host-web-request-unavailable` |
| Windows  | `unsupported` | `host-web-request-unavailable` |
| Linux    | `unsupported` | `host-web-request-unavailable` |

`isSupported` returns `{ supported: false, reason: "host-web-request-unavailable" }` from the host. Use `makeWebRequestMemoryClient()` for deterministic ordered-interceptor tests; use `makeWebRequestUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/web-request.ts`](../../../packages/native/src/web-request.ts)
- Contract: [`packages/native/src/contracts/web-request.ts`](../../../packages/native/src/contracts/web-request.ts)
