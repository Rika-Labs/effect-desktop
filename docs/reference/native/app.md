---
title: App (native)
description: App-level lifecycle and host operations.
kind: reference
audience: app-developers
effect_version: 4
---

# `App`

App-level lifecycle and host-operation service. `AppMetadata` owns app identity,
paths, launch context, and environment-shape reads.

The TypeScript surface is present for contract and bridge-client validation.
The Rust host implements `App.quit` by requesting event-loop exit and
`App.focus` by focusing the current native window. The Rust host also
implements `App.requestSingleInstanceLock` with a process-held OS file lock and
returns the primary process id when another process already owns the lock.
The host binary includes `--app-quit-smoke-test` to verify the live startup
window can exit through the app-quit lifecycle path.
Process restart, second-instance handoff, and native lifecycle event sources
are still unsupported until the host owns those lifecycle controls.
`Association` owns OS-level protocol and file association contracts.
`Autostart` owns open-at-login and login-item operations.

## Status

| Method                      | Success                   | Runtime support |
| --------------------------- | ------------------------- | --------------- |
| `quit`                      | `void`                    | supported       |
| `restart`                   | `void`                    | unsupported     |
| `focus`                     | `void`                    | supported       |
| `requestSingleInstanceLock` | `AppSingleInstanceResult` | supported       |

## Events

The current TypeScript event streams are `onSecondInstance`, `onOpenFile`,
`onOpenUrl`, and `onBeforeQuit`. `onSecondInstance` events carry `argv`, `cwd`,
`activationReason`, and `traceId`; `activationReason` is `"launch"`,
`"open-file"`, `"open-url"`, or `"unknown"`. Native event delivery is currently
unsupported until the second-instance handoff adapter exists.

`onOpenUrl` requires a syntactically valid URL with no ASCII control characters
and rejects dangerous schemes before application code receives the event:
`about:`, `blob:`, `data:`, `file:`, `javascript:`, `vbscript:`, and
`view-source:`.

`onOpenFile` requires an absolute platform path with no ASCII control
characters and no `.` or `..` path segments before application code receives
the event.

## Errors

`AppError` is the host protocol error union. Unsupported App methods decode
through Rust `App.*` routes and fail closed as typed `Unsupported`.
Subscriptions still do not have native lifecycle event sources.

## Notes

`Protocol.registerAppProtocol` owns the currently implemented custom protocol
serving path. `Association` owns OS-level default protocol and file association
contracts. `Autostart` owns OS-level login-item and autostart contracts.
`AppMetadata` owns app identity, paths, launch context, and environment-shape
contracts. App no longer exposes a duplicate protocol registration method.

## Related

- Reference: [`AppMetadata`](app-metadata.md), [`Association`](association.md), [`Autostart`](autostart.md), [`Window`](window.md), [`PowerMonitor`](power-monitor.md)
- Source: [`packages/native/src/app.ts`](../../../packages/native/src/app.ts)
