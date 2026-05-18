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

| Method                      | Success                   | Runtime support |
| --------------------------- | ------------------------- | --------------- |
| `getInfo`                   | `AppInfo`                 | unsupported     |
| `getCommandLine`            | `AppCommandLine`          | unsupported     |
| `quit`                      | `void`                    | unsupported     |
| `restart`                   | `void`                    | unsupported     |
| `focus`                     | `void`                    | unsupported     |
| `requestSingleInstanceLock` | `AppSingleInstanceResult` | unsupported     |
| `setOpenAtLogin`            | `void`                    | unsupported     |
| `registerProtocol`          | `void`                    | unsupported     |

## Events

The current TypeScript event streams are `onSecondInstance`, `onOpenFile`,
`onOpenUrl`, and `onBeforeQuit`. `onSecondInstance` events carry `argv`, `cwd`,
`activationReason`, and `traceId`; `activationReason` is `"launch"`,
`"open-file"`, `"open-url"`, or `"unknown"`. Native event delivery is currently
unsupported until the host adapter exists.

`onOpenUrl` requires a syntactically valid URL with no ASCII control characters
and rejects dangerous schemes before application code receives the event:
`about:`, `blob:`, `data:`, `file:`, `javascript:`, `vbscript:`, and
`view-source:`.

## Errors

`AppError` is the host protocol error union. Until the host adapter is
implemented, App methods decode through Rust `App.*` routes and fail closed as
typed `Unsupported`. Subscriptions still do not have native lifecycle event
sources.

## Notes

`Protocol.registerAppProtocol` owns the currently implemented custom protocol
serving path. `Association` owns OS-level default protocol and file association
contracts. `App.registerProtocol` remains unsupported until App lifecycle and
OS-level protocol registration are host-backed.

## Related

- Reference: [`Association`](association.md), [`Window`](window.md), [`PowerMonitor`](power-monitor.md)
- Source: [`packages/native/src/app.ts`](../../../packages/native/src/app.ts)
