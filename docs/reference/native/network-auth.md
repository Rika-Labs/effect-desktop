---
title: NetworkAuth (native)
description: Typed proxy, HTTP auth, and certificate decisions scoped to SessionProfile handles.
kind: reference
audience: app-developers
effect_version: 4
---

# `NetworkAuth`

`NetworkAuth` declares profile-scoped proxy policy, HTTP authentication decisions, certificate decisions, and events. The `SessionProfileHandle` is the session identity; network decisions do not live in global browser state.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport, checks `native.invoke` permissions before client side effects, and exposes `NetworkAuth.Event` as a typed stream. The memory client proves success, denial, unsupported, host failure, and certificate-security behavior without native WebView provider hooks.

## Methods

The surface exposes only the genuinely callable methods below.

| Method        | Payload                         | Success                  |
| ------------- | ------------------------------- | ------------------------ |
| `isSupported` | `void`                          | `{ supported, reason? }` |
| `setProxy`    | `{ profile, mode, server? }`    | `{ profile, mode, ... }` |
| `events`      | optional `SessionProfileHandle` | stream of events         |

## Capability facts (non-callable)

`handleAuth` and `handleCertificate` are **not callable**. They are advertised in the native capability manifest as capability facts with `support.status: "unsupported"`, so callers can discover the intended contract, but the surface does not register them as invocable RPCs.

| Capability fact     | Intended payload                      | Status        |
| ------------------- | ------------------------------------- | ------------- |
| `handleAuth`        | `{ profile, requestId, origin, ... }` | `unsupported` |
| `handleCertificate` | `{ profile, requestId, origin, ... }` | `unsupported` |

Proxy modes are `direct`, `system`, and `fixed`. The host currently supports `system` and `fixed` for future profile-bound WebViews on Windows and Linux; `fixed` requires an `http`, `https`, or `socks5` proxy server origin. macOS remains unsupported until the host enables Wry's macOS proxy path and gates the macOS 14+ requirement. `direct`, bypass lists, and updates to already-created WebViews are not supported. HTTP auth `allow` requires `username` and `password`; `deny` must omit credentials. Certificate fingerprints must be `sha256:` followed by 64 hex characters. The auth and certificate constraints describe the intended contract; those methods cannot currently be invoked.

## Support

The host can store proxy policy per `SessionProfileHandle` and apply Wry proxy configuration when creating new profile-bound WebViews. It does not mutate already-created WebViews, force direct mode, honor bypass lists, or support macOS yet. The current Wry-backed host path exposes navigation, page-load, download, drag/drop, new-window, and proxy configuration hooks, but not HTTP-auth or certificate-challenge callbacks that can be correlated to `SessionProfileHandle` and completed by `handleAuth` or `handleCertificate`. Because auth and certificate decisions are not implemented, they are published as non-callable capability facts with `support.status: "unsupported"` rather than registered as invocable RPCs.

| Method              | macOS                                                          | Windows                                                    | Linux                                                      |
| ------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| `setProxy`          | `unsupported` (`host-network-auth-proxy-platform-unavailable`) | `partial` (`host-network-auth-proxy-future-webviews-only`) | `partial` (`host-network-auth-proxy-future-webviews-only`) |
| `handleAuth`        | `unsupported` (`host-network-auth-unavailable`)                | `unsupported` (`host-network-auth-unavailable`)            | `unsupported` (`host-network-auth-unavailable`)            |
| `handleCertificate` | `unsupported` (`host-network-auth-unavailable`)                | `unsupported` (`host-network-auth-unavailable`)            | `unsupported` (`host-network-auth-unavailable`)            |

`isSupported` returns `{ supported: false, reason: "host-network-auth-unavailable" }` from the host. Use `makeNetworkAuthMemoryClient()` for deterministic `isSupported` and event tests; use `makeNetworkAuthUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/network-auth.ts`](../../../packages/native/src/network-auth.ts)
- Contract: [`packages/native/src/contracts/network-auth.ts`](../../../packages/native/src/contracts/network-auth.ts)
