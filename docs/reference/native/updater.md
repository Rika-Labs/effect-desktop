---
title: Updater (native)
description: Update-specific check, download, and install contract.
kind: reference
audience: app-developers
effect_version: 4
---

# `Updater`

Auto-update service contract. The TypeScript surface is Schema-typed and test-substitutable, but the native updater host adapter is not implemented yet. Calls through the real native bridge decode through Rust `Updater.*` routes and then fail closed as `host-adapter-unimplemented`.

`Updater.download` is update-specific status reporting, not a general app download manager. There is no `Download` service yet for arbitrary file downloads, destination selection, pause/resume/cancel controls, session-owned resource handles, or ordered progress/completion events.

## Methods

| Method              | Payload               | Success                                                    | Current support |
| ------------------- | --------------------- | ---------------------------------------------------------- | --------------- |
| `check`             | `{ currentVersion? }` | `{ available: boolean, version?: string, notes?: string }` | unsupported     |
| `download`          | `{ version? }`        | updater status result                                      | unsupported     |
| `install`           | `{ version? }`        | updater status result                                      | unsupported     |
| `installAndRestart` | `{ version? }`        | updater status result                                      | unsupported     |
| `getStatus`         | `void`                | updater status result                                      | unsupported     |
| `readyForRestart`   | `void`                | `void`                                                     | unsupported     |

## Types

`UpdaterCheckOptions`, `UpdaterDownloadOptions`, `UpdaterInstallOptions`.

## Errors

`UpdaterError` is the host protocol error union. Until the Rust adapter exists, native bridge calls fail as typed `Unsupported` host operations rather than claiming update security.

The host protocol includes `UpdateSignatureInvalid` for the future verifier's terminal bad-signature path. The current adapter does not emit it yet because manifest verification is not wired through the runtime host.

## Production checks

The current workflow helper does not verify update artifact signatures. It asks the `Updater` service to confirm update availability before staging bytes, which is not a cryptographic proof. Do not use it as a production updater until #1331 wires signed manifest verification, artifact staging, install, and restart through the Rust host.

Do not reuse `Updater` as a general download API. General downloads need their own native service and host state machine so interrupted transfers emit terminal events and remain visible to leak/resource inspection.

## Related

- Tutorial: [Package, sign, and ship](../../tutorials/04-package-and-sign.md)
- How-to: [Ship an update](../../how-to/ship-an-update.md)
- Source: [`packages/native/src/updater.ts`](../../../packages/native/src/updater.ts)
