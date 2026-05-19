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

| Method              | Payload                               | Success                  |
| ------------------- | ------------------------------------- | ------------------------ |
| `setProxy`          | `{ profile, mode, server?, bypass? }` | proxy result             |
| `handleAuth`        | `{ profile, requestId, origin, ... }` | decision record          |
| `handleCertificate` | `{ profile, requestId, origin, ... }` | decision record          |
| `isSupported`       | `void`                                | `{ supported, reason? }` |
| `events`            | optional `SessionProfileHandle`       | stream of events         |

Proxy modes are `direct`, `system`, and `fixed`. `fixed` requires an `http`, `https`, or `socks5` proxy server origin. HTTP auth `allow` requires `username` and `password`; `deny` must omit credentials. Certificate fingerprints must be `sha256:` followed by 64 hex characters.

Denied certificate decisions fail as typed `PermissionDenied` security errors. Malformed certificate fingerprints fail as typed `InvalidArgument` before client work.

## Support

The Rust host routes the methods and validates payloads, but it does not yet receive portable proxy, auth-challenge, or certificate-decision callbacks from profile-bound WebViews. Host requests therefore fail closed with typed `Unsupported` after validation.

| Platform | Status        | Reason                          |
| -------- | ------------- | ------------------------------- |
| macOS    | `unsupported` | `host-network-auth-unavailable` |
| Windows  | `unsupported` | `host-network-auth-unavailable` |
| Linux    | `unsupported` | `host-network-auth-unavailable` |

`isSupported` returns `{ supported: false, reason: "host-network-auth-unavailable" }` from the host. Use `makeNetworkAuthMemoryClient()` for deterministic success and security-denial tests; use `makeNetworkAuthUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/network-auth.ts`](../../../packages/native/src/network-auth.ts)
- Contract: [`packages/native/src/contracts/network-auth.ts`](../../../packages/native/src/contracts/network-auth.ts)
