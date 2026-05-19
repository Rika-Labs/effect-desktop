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

The Rust host owns the platform persistence write. `enable` creates or updates
the startup registration, `disable` removes it if present, and `isEnabled`
reports whether the registration exists for the current app identity.

## Status

| Method      | Success           | Runtime support |
| ----------- | ----------------- | --------------- |
| `isEnabled` | `AutostartStatus` | supported       |
| `enable`    | `AutostartStatus` | supported       |
| `disable`   | `AutostartStatus` | supported       |

## Mechanisms

`AutostartStatus.mechanism` reports the platform mechanism used by the host:

| Platform | Mechanism             | Runtime support |
| -------- | --------------------- | --------------- |
| macOS    | `macos-login-item`    | supported       |
| Windows  | `windows-run-key`     | supported       |
| Linux    | `linux-xdg-autostart` | supported       |
| Any      | `unsupported`         | unsupported     |

macOS uses a per-user LaunchAgent-style login item under
`~/Library/LaunchAgents`. Windows uses the current user's Run key. Linux uses a
per-user XDG autostart desktop file under `$XDG_CONFIG_HOME/autostart` or
`~/.config/autostart`.

## Events

The current event stream is `events()`. Event phases are `checked`, `enabled`,
`disabled`, and `failed`. The host emits an event after `isEnabled`, `enable`,
and `disable` when a runtime event sink is installed.

## Validation

`enable.args` entries must be non-empty strings and must not contain Unicode
control characters. Invalid launch arguments are rejected before native
transport.

## Errors

`AutostartError` is the host protocol error union. Malformed launch arguments or
unsafe app identity values return `InvalidArgument`. Host filesystem or registry
failure returns `HostUnavailable`. Platforms outside macOS, Windows, and Linux
return typed `Unsupported` with reason `host-adapter-unimplemented`.

## Related

- Reference: [`App`](app.md), [`Path`](path.md)
- Source: [`packages/native/src/autostart.ts`](../../../packages/native/src/autostart.ts)
