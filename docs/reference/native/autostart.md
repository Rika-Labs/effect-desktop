---
title: Autostart (native)
description: OS login-item and autostart boundary.
kind: reference
audience: app-developers
effect_version: 4
---

# `Autostart`

Declare OS-level login-item and autostart operations through the native host
boundary.

The TypeScript surface is present for contract and bridge-client validation
work, but the Rust host Autostart adapter is not implemented. The native surface
reports `unsupported` on macOS, Windows, and Linux until the host owns
platform-specific login-item persistence.

## Status

| Method      | Success           | Runtime support |
| ----------- | ----------------- | --------------- |
| `isEnabled` | `AutostartStatus` | unsupported     |
| `enable`    | `AutostartStatus` | unsupported     |
| `disable`   | `AutostartStatus` | unsupported     |

## Mechanisms

`AutostartStatus.mechanism` reports the platform mechanism when a host adapter
exists:

| Platform | Mechanism             | Runtime support |
| -------- | --------------------- | --------------- |
| macOS    | `macos-login-item`    | unsupported     |
| Windows  | `windows-run-key`     | unsupported     |
| Linux    | `linux-xdg-autostart` | unsupported     |
| Any      | `unsupported`         | unsupported     |

## Events

The current event stream is `events()`. Event phases are `checked`, `enabled`,
`disabled`, and `failed`. Native event delivery is currently unsupported until
the host adapter exists.

## Validation

`enable.args` entries must be non-empty strings and must not contain Unicode
control characters. Invalid launch arguments are rejected before native
transport.

## Errors

`AutostartError` is the host protocol error union. Malformed launch arguments
return `InvalidArgument`. Host transport failure returns `HostUnavailable`.
Until a platform adapter exists, decoded Autostart methods fail closed as typed
`Unsupported` with reason `host-adapter-unimplemented`.

## Related

- Reference: [`App`](app.md), [`Path`](path.md)
- Source: [`packages/native/src/autostart.ts`](../../../packages/native/src/autostart.ts)
