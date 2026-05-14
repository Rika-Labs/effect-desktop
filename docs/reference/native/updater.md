---
title: Updater (native)
description: Check, download, and install signed updates.
kind: reference
audience: app-developers
effect_version: 4
---

# `Updater`

Auto-update service. Verifies signed manifests against the embedded public key before downloading anything.

## Methods

| Method | Payload | Success |
| --- | --- | --- |
| `check` | `{}` | `{ available: boolean, version?: string, notes?: string }` |
| `download` | `{ version }` | `{ path: string }` |
| `install` | `{ version }` | `void` |

## Types

`UpdaterCheckOptions`, `UpdaterDownloadOptions`, `UpdaterInstallOptions`.

## Errors

`UpdaterError` — `SignatureInvalid`, `HashMismatch`, `Unavailable`, `Network`, `Permission`.

## Production checks

`update-install-without-signature` rule fails any `install` path that bypasses verification.

## Related

- Tutorial: [Package, sign, and ship](../../tutorials/04-package-and-sign.md)
- How-to: [Ship an update](../../how-to/ship-an-update.md)
- Source: [`packages/native/src/updater.ts`](../../../packages/native/src/updater.ts)
