---
title: Protocol (native)
description: Host-backed custom protocol policy registration.
kind: reference
audience: app-developers
effect_version: 4
---

# `Protocol`

Register custom renderer protocol policy with the native host. Protocol policy is scoped by scheme and path; it does not expose arbitrary filesystem paths unless `serveAsset` registers an explicit existing directory root for that scheme. Registered policies are applied when the host builds WebViews; existing WebViews keep the custom protocol registrations they were built with.

The fixed internal `app://localhost/` WebView asset protocol is owned by the host runtime and remains separate from this public custom protocol policy surface.

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

Schemes must match `^[a-z][a-z0-9+.-]*$` and cannot be reserved browser or host schemes such as `app`, `file`, `http`, `https`, `data`, or `javascript`.

`serveAsset.root` must be a non-empty absolute local path to an existing scoped directory, not a filesystem root. It rejects control characters and traversal segments. URL paths for `serveRoute.route` and `deny.path` must start with `/` and reject malformed percent escapes, encoded traversal, backslashes, control characters, and `.` or `..` segments before native transport.

## Errors

`ProtocolError` is the host protocol error union. Malformed schemes, roots, and URL paths return `InvalidArgument`. Host transport failure returns `HostUnavailable`; platform or host policy refusal returns `Unsupported`.

## Related

- Reference: [Configuration production checks](../config.md), [`Shell`](shell.md)
- Source: [`packages/native/src/protocol.ts`](../../../packages/native/src/protocol.ts)
