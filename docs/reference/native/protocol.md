---
title: Protocol (native)
description: App protocol handler registration for deep linking.
kind: reference
audience: app-developers
effect_version: 4
---

# `Protocol`

Register and route custom URL schemes (deep linking). When the user clicks `myapp://` URL elsewhere, the OS routes it to your app.

## Methods

| Method       | Payload      | Success |
| ------------ | ------------ | ------- |
| `register`   | `{ scheme }` | `void`  |
| `unregister` | `{ scheme }` | `void`  |

Event stream of `{ url: string }` for incoming protocol activations.

## Errors

`ProtocolError`.

## Production check

`app-protocol-path-traversal` rule (in `desktop check`) catches handlers that allow `..` traversal in the URL path.

## Related

- Reference: [Configuration production checks](../config.md), [`Shell`](shell.md)
- Source: [`packages/native/src/protocol.ts`](../../../packages/native/src/protocol.ts)
