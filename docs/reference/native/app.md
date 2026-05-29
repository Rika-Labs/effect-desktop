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
The Rust host implements `App.quit` and `App.exit` by requesting event-loop exit
with a portable exit code, `App.restart` and `App.relaunch` by launching the
current executable with validated restart args before requesting event-loop
exit, and `App.focus` and `App.activate` by focusing the current native window.
The Rust host also implements `App.requestSingleInstanceLock` with a
process-held OS file lock and returns the primary process id when another
process already owns the lock. `App.releaseSingleInstanceLock` explicitly drops
the process-held lock and any duplicate-launch handoff listener. When the
primary process owns a runtime event stream, duplicate launch attempts forward
`argv`, `cwd`, `activationReason`, and `traceId` to the primary process as
the host event method `App.onSecondInstance`. Safe open-file and open-url
intents from the primary launch argv and duplicate-launch argv are also emitted
through the host event methods `App.onOpenFile` or `App.onOpenUrl`.
`activationReason` is classified from argv as `"open-file"` when exactly one
safe absolute file path is present, `"open-url"` when exactly one safe
non-dangerous URL is present, `"unknown"` when intent-like argv is unsafe or
ambiguous, and `"launch"` otherwise. `--single-instance-lock-smoke-test`
verifies this lock across host processes.
The host binary includes `--app-quit-smoke-test`, `--app-focus-smoke-test`, and
`--app-restart-smoke-test` to verify live startup windows can exit through the
app-quit lifecycle path, focus through the native window-manager path, and
launch a smoke-only replacement process.
`Association` owns OS-level protocol and file association contracts.
`Autostart` owns open-at-login and login-item operations.

## Status

| Method                      | Success                   | Runtime support |
| --------------------------- | ------------------------- | --------------- |
| `quit`                      | `void`                    | supported       |
| `exit`                      | `void`                    | supported       |
| `restart`                   | `void`                    | supported       |
| `relaunch`                  | `void`                    | supported       |
| `focus`                     | `void`                    | supported       |
| `activate`                  | `void`                    | supported       |
| `requestSingleInstanceLock` | `AppSingleInstanceResult` | supported       |
| `releaseSingleInstanceLock` | `void`                    | supported       |

## Events

The TypeScript service methods `onSecondInstance`, `onOpenFile`, `onOpenUrl`,
and `onBeforeQuit` consume canonical RPC streams:

- `App.events.onSecondInstance`
- `App.events.onOpenFile`
- `App.events.onOpenUrl`
- `App.events.onBeforeQuit`

The native/web bridge maps those canonical stream tags to the existing host
event methods `App.onSecondInstance`, `App.onOpenFile`, `App.onOpenUrl`, and
`App.onBeforeQuit` at the boundary. `onSecondInstance` events carry `argv`,
`cwd`, `activationReason`, and `traceId`; `activationReason` is `"launch"`,
`"open-file"`, `"open-url"`, or `"unknown"`. `onBeforeQuit` is emitted by the
Rust host before the current `App.quit` path exits the event loop and before a
native close request exits the app. Native `onSecondInstance` is emitted by the
single-instance handoff path for duplicate launches, including argv-derived
open-file/open-url activation reasons. Native `onOpenFile` and `onOpenUrl` are
emitted from the same argv classifier: the host emits at most one open intent
event, after `onSecondInstance` for duplicate launches, and does not emit an
open intent event for unsafe or ambiguous argv. Event delivery uses the host
runtime event stream; if no renderer subscription is installed yet, the primary
launch intent remains pending until `requestSingleInstanceLock` installs the
runtime event sender.

`onOpenUrl` requires a syntactically valid URL with no ASCII control characters
and rejects dangerous schemes before application code receives the event:
`about:`, `blob:`, `data:`, `file:`, `javascript:`, `vbscript:`, and
`view-source:`.

`onOpenFile` requires an absolute platform path with no ASCII control
characters and no `.` or `..` path segments before application code receives
the event.

## Errors

`AppError` is the host protocol error union. All `App` methods advertise
`supported` in their descriptors and decode through Rust `App.*` routes; client
RPC failures are normalized to typed `AppError` and host transport failures map
through the host protocol error union. `onBeforeQuit` has a host event source
for app-exit paths, and `onSecondInstance`, `onOpenFile`, and `onOpenUrl` have
host event sources for single-instance launch and duplicate-launch handoff
paths.

## Notes

`Protocol.registerAppProtocol` owns the currently implemented custom protocol
serving path. `Association` owns OS-level default protocol and file association
contracts. `Autostart` owns OS-level login-item and autostart contracts.
`AppMetadata` owns app identity, paths, launch context, and environment-shape
contracts. App no longer exposes a duplicate protocol registration method.

## Migration

Use `App.layer` directly when composing the App service. `AppLive` was removed
because it was only a public alias for the canonical Effect service layer.

Architecture-debt sweep outcome for #1918: removed the shallow `AppLive` alias;
kept `App`, `AppClient`, `AppSurface`, `AppRpcs`, `AppHandlersLive`, strict
bridge decoding, invalid argument guards, host error mapping, single-instance
event streams, and `AppEventRouter` because they own durable service,
native/web boundary, validation, lifecycle, or event-routing semantics.

## Related

- Reference: [`AppMetadata`](app-metadata.md), [`Association`](association.md), [`Autostart`](autostart.md), [`Window`](window.md), [`PowerMonitor`](power-monitor.md)
- Source: [`packages/native/src/app.ts`](../../../packages/native/src/app.ts)
