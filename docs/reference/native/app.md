---
title: App (native)
description: App-level lifecycle and host operations.
kind: reference
audience: app-developers
effect_version: 4
---

# `App`

App-level lifecycle and host-operation service.

The TypeScript surface is present for contract and bridge-client validation
work, but the Rust host App adapter is not implemented. The native surface
reports `unsupported` on macOS, Windows, and Linux until the host owns app
lifecycle control, protocol registration, open-at-login integration, single
instance coordination, app metadata, and lifecycle events.

## Status

| Method                      | Success                    | Runtime support |
| --------------------------- | -------------------------- | --------------- |
| `getInfo`                   | `AppInfo`                  | unsupported     |
| `getCommandLine`            | `AppCommandLine`           | unsupported     |
| `quit`                      | `void`                     | unsupported     |
| `restart`                   | `void`                     | unsupported     |
| `focus`                     | `void`                     | unsupported     |
| `requestSingleInstanceLock` | `AppSingleInstanceResult`  | unsupported     |
| `setOpenAtLogin`            | `void`                     | unsupported     |
| `registerProtocol`          | `void`                     | unsupported     |

## Events

The current TypeScript event streams are `onSecondInstance`, `onOpenFile`,
`onOpenUrl`, and `onBeforeQuit`. Native event delivery is currently unsupported
until the host adapter exists.

## Errors

`AppError` is the host protocol error union. Until the host adapter is
implemented, bridge calls and subscriptions reach an unsupported or missing host
path rather than real app lifecycle behavior.

## Notes

`Protocol.registerAppProtocol` owns the currently implemented custom protocol
serving path. `App.registerProtocol` remains unsupported until App lifecycle and
OS-level protocol registration are host-backed.

## Related

- Reference: [`Window`](window.md), [`PowerMonitor`](power-monitor.md)
- Source: [`packages/native/src/app.ts`](../../../packages/native/src/app.ts)
