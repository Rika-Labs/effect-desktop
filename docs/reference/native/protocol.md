---
title: Protocol (native)
description: Host-backed custom protocol policy registration.
kind: reference
audience: app-developers
effect_version: 4
---

# `Protocol`

Register custom renderer protocol policy with the native host. Protocol policy is scoped by scheme and path; it does not expose arbitrary filesystem paths unless `serveAsset` registers an explicit existing directory root for that scheme.

Protocol policy is startup configuration. The host freezes the registry when it builds a WebView, because Wry attaches custom protocol handlers to the WebView builder. Calls made after WebView creation return `Unsupported` instead of pretending to update existing WebViews.

The fixed internal `app://localhost/` WebView asset protocol is owned by the host runtime and remains separate from this public custom protocol policy surface.

This surface handles custom protocol policy and app asset responses. It does
not provide request/response interception for normal WebView navigation,
subresources, headers, redirects, or audit.
It also does not configure proxies, answer HTTP auth challenges, or make
certificate trust decisions.

OS-level default protocol clients and file associations are not part of this
surface. Use [`Association`](association.md) for those contracts.

## Methods

| Method                | Payload             | Success |
| --------------------- | ------------------- | ------- |
| `registerAppProtocol` | `{ scheme }`        | `void`  |
| `serveAsset`          | `{ scheme, root }`  | `void`  |
| `serveRoute`          | `{ scheme, route }` | `void`  |
| `deny`                | `{ scheme, path }`  | `void`  |

## Platform Matrix

| Method                | macOS     | Windows   | Linux     |
| --------------------- | --------- | --------- | --------- |
| `registerAppProtocol` | supported | supported | supported |
| `serveAsset`          | supported | supported | supported |
| `serveRoute`          | supported | supported | supported |
| `deny`                | supported | supported | supported |

## Validation

Schemes must match `^[a-z][a-z0-9+.-]*$` and cannot be reserved browser or host schemes. The contract rejects `about`, `app`, `blob`, `chrome`, `data`, `file`, `http`, `https`, `javascript`, `vbscript`, and `view-source`.

`serveAsset.root` must be a non-empty absolute local path to an existing scoped directory, not a filesystem root. It rejects control characters and traversal segments. URL paths for `serveRoute.route` and `deny.path` must start with `/` and reject malformed percent escapes, encoded traversal, backslashes, control characters, and `.` or `..` segments before native transport.

Custom protocol requests must use the registered scheme with canonical `localhost` authority and no port, for example `assets://localhost/file.txt`. Other hosts or authorities return `404`.

Registered schemes without an asset root fail closed with `403`. Denied paths return `403`; missing files return `404`; methods other than `GET` and `HEAD` return `405`. Successful custom protocol responses include the active Content Security Policy. HTML responses are rewritten with a fresh CSP nonce before the host returns them.

## Errors

`ProtocolError` is the host protocol error union. Malformed schemes, roots, and URL paths return `InvalidArgument`. Host transport failure returns `HostUnavailable`; platform or host policy refusal returns `Unsupported`. Runtime policy mutation after WebView creation is `Unsupported`.

## Related

- Reference: [Configuration production checks](../config.md), [`Association`](association.md), [`Shell`](shell.md)
- Source: [`packages/native/src/protocol.ts`](../../../packages/native/src/protocol.ts)
