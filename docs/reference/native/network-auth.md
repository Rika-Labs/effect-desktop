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
| `events`      | optional `SessionProfileHandle` | stream of events         |

## Capability facts (non-callable)

`setProxy`, `handleAuth`, and `handleCertificate` are **not callable**. They are advertised in the native capability manifest as capability facts with `support.status: "unsupported"`, so callers can discover the intended contract, but the surface does not register them as invocable RPCs.

| Capability fact     | Intended payload                      | Status        |
| ------------------- | ------------------------------------- | ------------- |
| `setProxy`          | `{ profile, mode, server?, bypass? }` | `unsupported` |
| `handleAuth`        | `{ profile, requestId, origin, ... }` | `unsupported` |
| `handleCertificate` | `{ profile, requestId, origin, ... }` | `unsupported` |

Proxy modes are `direct`, `system`, and `fixed`. `fixed` requires an `http`, `https`, or `socks5` proxy server origin. HTTP auth `allow` requires `username` and `password`; `deny` must omit credentials. Certificate fingerprints must be `sha256:` followed by 64 hex characters. These constraints describe the intended contract; the methods cannot currently be invoked.

## Support

The host does not yet receive portable proxy, auth-challenge, or certificate-decision callbacks from profile-bound WebViews. Because those methods are not implemented, they are published as non-callable capability facts with `support.status: "unsupported"` rather than registered as invocable RPCs.

| Platform | Status        | Reason                          |
| -------- | ------------- | ------------------------------- |
| macOS    | `unsupported` | `host-network-auth-unavailable` |
| Windows  | `unsupported` | `host-network-auth-unavailable` |
| Linux    | `unsupported` | `host-network-auth-unavailable` |

`isSupported` returns `{ supported: false, reason: "host-network-auth-unavailable" }` from the host. Use `makeNetworkAuthMemoryClient()` for deterministic `isSupported` and event tests; use `makeNetworkAuthUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/network-auth.ts`](../../../packages/native/src/network-auth.ts)
- Contract: [`packages/native/src/contracts/network-auth.ts`](../../../packages/native/src/contracts/network-auth.ts)
