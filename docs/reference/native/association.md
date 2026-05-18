---
title: Association (native)
description: OS protocol and file association boundary.
kind: reference
audience: app-developers
effect_version: 4
---

# `Association`

Declare and query OS-level protocol and file associations through the native
host boundary.

The TypeScript surface is present for contract and bridge-client validation
work, but the Rust host Association adapter is not implemented. The native
surface reports `unsupported` on macOS, Windows, and Linux until the host owns
platform-specific default-protocol and file-association APIs.

`Association` is separate from [`Protocol`](protocol.md). `Protocol` owns
in-app custom protocol serving for WebViews. `Association` owns OS default
handlers such as "is this app the default client for this scheme?" and "which
extensions are associated with this app?"

## Status

| Method                     | Success                             | Runtime support |
| -------------------------- | ----------------------------------- | --------------- |
| `isDefaultProtocolClient`  | `AssociationProtocolStatus`         | unsupported     |
| `setDefaultProtocolClient` | `void`                              | unsupported     |
| `getFileAssociations`      | `AssociationFileAssociationsResult` | unsupported     |

## Events

The current event stream is `events()`. Event phases are
`protocol-checked`, `protocol-updated`, `file-associations-checked`, and
`failed`. Native event delivery is currently unsupported until the host adapter
exists.

## Validation

Protocol schemes use the same custom-scheme contract as `Protocol`: lowercase
ASCII schemes matching `^[a-z][a-z0-9+.-]*$`, excluding reserved schemes such as
`app`, `file`, `http`, `https`, `data`, and `javascript`.

File extensions must start with `.`, contain at least one ASCII alphanumeric
character after the dot, and may contain ASCII letters, digits, `.`, `_`, and
`-`. Traversal segments such as `..` are rejected before native transport.

## Errors

`AssociationError` is the host protocol error union. Malformed schemes and file
extensions return `InvalidArgument`. Host transport failure returns
`HostUnavailable`. Until a platform adapter exists, decoded Association methods
fail closed as typed `Unsupported` with reason `host-adapter-unimplemented`.

## Related

- Reference: [`App`](app.md), [`Protocol`](protocol.md)
- Source: [`packages/native/src/association.ts`](../../../packages/native/src/association.ts)
