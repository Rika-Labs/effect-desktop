---
title: Updater (native)
description: Check, download, and install signed updates.
kind: reference
audience: app-developers
effect_version: 4
---

# `Updater`

Auto-update service contract. The TypeScript surface is Schema-typed and test-substitutable, but the native updater host adapter is not implemented yet. Calls through the real native bridge currently have no Rust `Updater.*` route and are reported as `host-adapter-unimplemented` in the parity matrix.

## Methods

| Method              | Payload       | Success                                                    | Current support |
| ------------------- | ------------- | ---------------------------------------------------------- | --------------- |
| `check`             | `{ currentVersion? }` | `{ available: boolean, version?: string, notes?: string }` | unsupported     |
| `download`          | `{ version? }` | updater status result                                      | unsupported     |
| `install`           | `{ version? }` | updater status result                                      | unsupported     |
| `installAndRestart` | `{ version? }` | updater status result                                      | unsupported     |
| `getStatus`         | `void`        | updater status result                                      | unsupported     |
| `readyForRestart`   | `void`        | `void`                                                     | unsupported     |

## Types

`UpdaterCheckOptions`, `UpdaterDownloadOptions`, `UpdaterInstallOptions`.

## Errors

`UpdaterError` is the host protocol error union. Until the Rust adapter exists, native bridge calls fail as missing/unsupported host operations rather than claiming update security.

## Production checks

The current workflow helper does not verify update artifact signatures. It asks the `Updater` service to confirm update availability before staging bytes, which is not a cryptographic proof. Do not use it as a production updater until #1331 wires signed manifest verification, artifact staging, install, and restart through the Rust host.

## Related

- Tutorial: [Package, sign, and ship](../../tutorials/04-package-and-sign.md)
- How-to: [Ship an update](../../how-to/ship-an-update.md)
- Source: [`packages/native/src/updater.ts`](../../../packages/native/src/updater.ts)
