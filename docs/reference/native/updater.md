---
title: Updater (native)
description: Update-specific check, download, and install contract.
kind: reference
audience: app-developers
effect_version: 4
---

# `Updater`

Auto-update service contract. The TypeScript surface is Schema-typed and test-substitutable. The native host currently supports only a local signed-manifest check: `Updater.check` can verify a caller-supplied manifest JSON string against caller-supplied Ed25519 trust anchors, then report whether that manifest version differs from `currentVersion`.

The host does not fetch feeds, download artifacts, stage installs, enforce update policy, or restart into an installed update yet. Those methods still fail closed as `host-adapter-unimplemented`.

`Updater.download` is update-specific status reporting, not a general app download manager. There is no `Download` service yet for arbitrary file downloads, destination selection, pause/resume/cancel controls, session-owned resource handles, or ordered progress/completion events.

## Methods

| Method              | Payload                                             | Success                                                    | Current support |
| ------------------- | --------------------------------------------------- | ---------------------------------------------------------- | --------------- |
| `check`             | `{ currentVersion?, manifestJson?, trustAnchors? }` | `{ available: boolean, version?: string, notes?: string }` | partial         |
| `download`          | `{ version? }`                                      | updater status result                                      | unsupported     |
| `install`           | `{ version? }`                                      | updater status result                                      | unsupported     |
| `installAndRestart` | `{ version? }`                                      | updater status result                                      | unsupported     |
| `getStatus`         | `void`                                              | updater status result                                      | unsupported     |
| `readyForRestart`   | `void`                                              | `void`                                                     | unsupported     |

## Types

`UpdaterCheckOptions`, `UpdaterDownloadOptions`, `UpdaterInstallOptions`.

`manifestJson` and `trustAnchors` must be provided together. Each trust anchor has `{ keyVersion, publicKey }`, where `publicKey` is an `ed25519:<base64>` public key envelope.

## Errors

`UpdaterError` is the host protocol error union. Unsupported update lifecycle calls fail as typed `Unsupported` host operations rather than claiming update security.

`Updater.check` emits `UpdateSignatureInvalid` for missing, invalid, tampered, or untrusted manifest signatures. Malformed manifests and malformed trust anchors are `InvalidArgument`.

## Production checks

The current workflow helper does not verify downloaded artifact bytes or install handoff. It asks the `Updater` service to confirm update availability before staging bytes, which only proves the supplied manifest signature when `manifestJson` and `trustAnchors` are present. Do not use it as a production updater until #1331 wires artifact verification, staging, install, restart, permission/audit policy, and diagnostics evidence through the Rust host.

Do not reuse `Updater` as a general download API. General downloads need their own native service and host state machine so interrupted transfers emit terminal events and remain visible to leak/resource inspection.

## Related

- Tutorial: [Package, sign, and ship](../../tutorials/04-package-and-sign.md)
- How-to: [Ship an update](../../how-to/ship-an-update.md)
- Source: [`packages/native/src/updater.ts`](../../../packages/native/src/updater.ts)
