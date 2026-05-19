---
title: Updater (native)
description: Update-specific check, download, and install contract.
kind: reference
audience: app-developers
effect_version: 4
---

# `Updater`

Auto-update service contract. The TypeScript surface is Schema-typed and test-substitutable. The native host currently supports a local signed-manifest check, local file artifact staging for that verified manifest, and status for those host-owned steps. `Updater.check` can verify a caller-supplied manifest JSON string against caller-supplied Ed25519 trust anchors, then report whether that manifest version differs from `currentVersion`. `Updater.download` can stage the verified manifest's current-platform `file://` artifact after checking its signed byte count and SHA-256 digest. `Updater.getStatus` reports the host-owned result as `idle`, `update-available`, `downloading`, `downloaded`, or `error`.

The host does not fetch feeds, download network artifacts, commit staged installs, enforce update policy, or restart into an installed update yet. Unsupported lifecycle methods still fail closed as `host-adapter-unimplemented`.

`Updater.download` is update-specific status reporting, not a general app download manager. There is no `Download` service yet for arbitrary file downloads, destination selection, pause/resume/cancel controls, session-owned resource handles, or ordered progress/completion events.

## Methods

| Method              | Payload                                             | Success                                                    | Current support |
| ------------------- | --------------------------------------------------- | ---------------------------------------------------------- | --------------- |
| `check`             | `{ currentVersion?, manifestJson?, trustAnchors? }` | `{ available: boolean, version?: string, notes?: string }` | partial         |
| `download`          | `{ version? }`                                      | updater status result                                      | partial         |
| `install`           | `{ version? }`                                      | updater status result                                      | unsupported     |
| `installAndRestart` | `{ version? }`                                      | updater status result                                      | unsupported     |
| `getStatus`         | `void`                                              | updater status result                                      | partial         |
| `readyForRestart`   | `void`                                              | `void`                                                     | unsupported     |

## Types

`UpdaterCheckOptions`, `UpdaterDownloadOptions`, `UpdaterInstallOptions`.

`manifestJson` and `trustAnchors` must be provided together. Each trust anchor has `{ keyVersion, publicKey }`, where `publicKey` is an `ed25519:<base64>` public key envelope.

## Errors

`UpdaterError` is the host protocol error union. Unsupported update lifecycle calls fail as typed `Unsupported` host operations rather than claiming update security.

`Updater.check` emits `UpdateSignatureInvalid` for missing, invalid, tampered, or untrusted manifest signatures. Malformed manifests and malformed trust anchors are `InvalidArgument`.

`Updater.download` requires a prior successful signed-manifest check for a newer version. It supports only current-platform `file://` artifacts from that verified manifest. Missing prior check is `InvalidState`; a requested version that does not match the verified manifest is `NotFound`; non-file artifact URLs are `Unsupported`; truncated artifacts are `UpdateDownloadTruncated`; digest mismatches are `UpdateSignatureInvalid`.

`Updater.getStatus` is limited to signed-manifest check and local artifact staging state. It does not report feed polling, network download, install, restart, or rollback state yet.

## Production checks

The current workflow helper can rely on the host only for signed manifest verification and local file artifact staging. Do not use it as a production updater until #1331 wires feed policy, network download, install, restart, permission/audit policy, lifecycle events, and diagnostics evidence through the Rust host.

Do not reuse `Updater` as a general download API. General downloads need their own native service and host state machine so interrupted transfers emit terminal events and remain visible to leak/resource inspection.

## Related

- Tutorial: [Package, sign, and ship](../../tutorials/04-package-and-sign.md)
- How-to: [Ship an update](../../how-to/ship-an-update.md)
- Source: [`packages/native/src/updater.ts`](../../../packages/native/src/updater.ts)
