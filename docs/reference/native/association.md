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

The Rust host owns the platform query or mutation. macOS routes through
LaunchServices for default protocol clients and file-extension default handlers.
Windows and Linux remain explicit typed unsupported paths until those platform
adapters exist.

`Association` is separate from [`Protocol`](protocol.md). `Protocol` owns
in-app custom protocol serving for WebViews. `Association` owns OS default
handlers such as "is this app the default client for this scheme?" and "which
extensions are associated with this app?"

## Status

| Method                     | Success                             | Runtime support |
| -------------------------- | ----------------------------------- | --------------- |
| `isDefaultProtocolClient`  | `AssociationProtocolStatus`         | partial         |
| `setDefaultProtocolClient` | `void`                              | partial         |
| `getFileAssociations`      | `AssociationFileAssociationsResult` | partial         |

| Platform | Runtime support | Mechanism      |
| -------- | --------------- | -------------- |
| macOS    | supported       | LaunchServices |
| Windows  | unsupported     | none           |
| Linux    | unsupported     | none           |

## Events

The current event stream is `events()`, backed by the
`Association.events.Event` RPC stream contract. Event phases are
`protocol-checked`, `protocol-updated`, `file-associations-checked`, and
`failed`. Bridge clients still translate that contract to the host wire event
method `Association.Event`.

## Validation

Protocol schemes use the same custom-scheme contract as `Protocol`: lowercase
ASCII schemes matching `^[a-z][a-z0-9+.-]*$`, excluding reserved schemes such as
`app`, `file`, `http`, `https`, `data`, `javascript`, and `vbscript`.

File extensions must start with `.`, contain at least one ASCII alphanumeric
character after the dot, and may contain ASCII letters, digits, `.`, `_`, and
`-`. Traversal segments such as `..` are rejected before native transport.

## Errors

`AssociationError` is the host protocol error union. Malformed schemes and file
extensions return `InvalidArgument`. Host transport failure returns
`HostUnavailable`. Windows, Linux, and platforms without an adapter fail closed
as typed `Unsupported` with reason `host-adapter-unimplemented`.

## Related

- Reference: [`App`](app.md), [`Protocol`](protocol.md)
- Source: [`packages/native/src/association.ts`](../../../packages/native/src/association.ts)
