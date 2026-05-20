---
title: NativeNetwork (native)
description: Permission-gated HTTP, upload, WebSocket, and localhost helper contracts.
kind: reference
audience: app-developers
effect_version: 4
---

# `NativeNetwork`

`NativeNetwork` declares permission-gated native transport helpers for HTTP fetches, uploads, WebSocket connections, and localhost URL construction. It is the transport surface; policy decisions such as allow/deny rules still belong in `EgressPolicy`.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport, checks `native.invoke` permissions before client side effects, and exposes typed `NativeNetwork.Event` progress/lifecycle events. The transport methods (`fetch`, `upload`, `connectWebSocket`, `closeWebSocket`, `localhostUrl`) are currently non-callable capability facts; only `isSupported` and the event stream are invocable.

## Methods

The surface exposes only the genuinely callable methods below.

| Method        | Payload | Success                  |
| ------------- | ------- | ------------------------ |
| `isSupported` | `void`  | `{ supported, reason? }` |
| `events`      | `void`  | stream of events         |

## Capability facts (non-callable)

`fetch`, `upload`, `connectWebSocket`, `closeWebSocket`, and `localhostUrl` are **not callable**. They are advertised in the native capability manifest as capability facts with `support.status: "unsupported"`, so callers can discover the intended contract, but the surface does not register them as invocable RPCs.

| Capability fact    | Intended payload                   | Status        |
| ------------------ | ---------------------------------- | ------------- |
| `fetch`            | `{ url, method, headers?, body? }` | `unsupported` |
| `upload`           | `{ url, body, method?, ... }`      | `unsupported` |
| `connectWebSocket` | `{ url, protocols? }`              | `unsupported` |
| `closeWebSocket`   | `{ socket }`                       | `unsupported` |
| `localhostUrl`     | `{ port, path?, secure? }`         | `unsupported` |

The intended contract: `fetch` accepts HTTP(S) URLs and methods `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `HEAD`, and `GET` requests must omit `body`. `upload` accepts HTTP(S) URLs, a string body, and optional `POST`, `PUT`, or `PATCH`. `connectWebSocket` accepts only `ws` and `wss` URLs. `localhostUrl` accepts ports from 1 through 65535 and absolute paths without traversal. These constraints describe the intended contract; the methods cannot currently be invoked.

## Support

The host does not yet provide a portable native HTTP/WebSocket transport adapter. Because those methods are not implemented, they are published as non-callable capability facts with `support.status: "unsupported"` rather than registered as invocable RPCs.

| Platform | Status        | Reason                            |
| -------- | ------------- | --------------------------------- |
| macOS    | `unsupported` | `host-native-network-unavailable` |
| Windows  | `unsupported` | `host-native-network-unavailable` |
| Linux    | `unsupported` | `host-native-network-unavailable` |

`isSupported` returns `{ supported: false, reason: "host-native-network-unavailable" }` from the host. Use `makeNativeNetworkMemoryClient()` for deterministic `isSupported` and event tests; use `makeNativeNetworkUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/native-network.ts`](../../../packages/native/src/native-network.ts)
- Contract: [`packages/native/src/contracts/native-network.ts`](../../../packages/native/src/contracts/native-network.ts)
