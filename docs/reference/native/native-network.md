---
title: NativeNetwork (native)
description: Permission-gated HTTP, upload, WebSocket, and localhost helper contracts.
kind: reference
audience: app-developers
effect_version: 4
---

# `NativeNetwork`

`NativeNetwork` declares permission-gated native transport helpers for HTTP fetches, uploads, WebSocket connections, and localhost URL construction. It is the transport surface; policy decisions such as allow/deny rules still belong in `EgressPolicy`.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport, checks `native.invoke` permissions before client side effects, registers long-lived WebSocket handles with `ResourceRegistry`, and exposes typed `NativeNetwork.Event` progress/lifecycle events. The memory client proves success, denial, unsupported, host failure, malformed input rejection, and WebSocket cleanup without real network I/O.

## Methods

| Method             | Payload                            | Success                  |
| ------------------ | ---------------------------------- | ------------------------ |
| `fetch`            | `{ url, method, headers?, body? }` | fetch result             |
| `upload`           | `{ url, body, method?, ... }`      | upload result            |
| `connectWebSocket` | `{ url, protocols? }`              | WebSocket snapshot       |
| `closeWebSocket`   | `{ socket }`                       | WebSocket snapshot       |
| `localhostUrl`     | `{ port, path?, secure? }`         | localhost URL result     |
| `isSupported`      | `void`                             | `{ supported, reason? }` |
| `events`           | `void`                             | stream of events         |

`fetch` accepts HTTP(S) URLs and methods `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `HEAD`. `GET` requests must omit `body`. `upload` accepts HTTP(S) URLs, a string body, and optional `POST`, `PUT`, or `PATCH`. `connectWebSocket` accepts only `ws` and `wss` URLs. `localhostUrl` accepts ports from 1 through 65535 and absolute paths without traversal.

WebSocket connections are long-lived resources. Closing the owner scope closes the socket through the same typed `closeWebSocket` client path used by explicit close calls.

## Support

The Rust host routes the methods and validates payloads, but it does not yet provide a portable native HTTP/WebSocket transport adapter. Host requests therefore fail closed with typed `Unsupported` after validation.

| Platform | Status        | Reason                            |
| -------- | ------------- | --------------------------------- |
| macOS    | `unsupported` | `host-native-network-unavailable` |
| Windows  | `unsupported` | `host-native-network-unavailable` |
| Linux    | `unsupported` | `host-native-network-unavailable` |

`isSupported` returns `{ supported: false, reason: "host-native-network-unavailable" }` from the host. Use `makeNativeNetworkMemoryClient()` for deterministic transport and cancellation tests; use `makeNativeNetworkUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/native-network.ts`](../../../packages/native/src/native-network.ts)
- Contract: [`packages/native/src/contracts/native-network.ts`](../../../packages/native/src/contracts/native-network.ts)
