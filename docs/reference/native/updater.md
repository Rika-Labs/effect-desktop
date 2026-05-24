---
title: Updater (native)
description: Update-specific check, download, and install contract.
kind: reference
audience: app-developers
effect_version: 4
---

# `Updater`

Auto-update service contract. The TypeScript surface is Schema-typed and test-substitutable. The native host currently supports an executable local subset: signed-manifest check, local file artifact staging for that verified manifest, committing the staged artifact into the host-owned current-bundle path, and status for those host-owned steps. `Updater.check` verifies a caller-supplied manifest JSON string against caller-supplied Ed25519 trust anchors, then reports whether that manifest version differs from `currentVersion`. `Updater.download` can stage the verified manifest's current-platform `file://` artifact after checking its signed byte count and SHA-256 digest. `Updater.install` commits the staged artifact. `Updater.installAndRestart` commits the staged artifact and emits `Updater.PreparingRestart`; `Updater.readyForRestart` acknowledges that renderer work is quiesced before restart. `Updater.getStatus` reports the host-owned result as `idle`, `update-available`, `downloading`, `downloaded`, `installing`, or `error`.

The host does not fetch feeds, download network artifacts, enforce update policy, or relaunch the process into an installed update yet. The current restart path is a typed readiness handshake over the local staged install.

`Updater.download` is update-specific status reporting, not a general app download manager. There is no `Download` service yet for arbitrary file downloads, destination selection, pause/resume/cancel controls, session-owned resource handles, or ordered progress/completion events.

`Updater.download` remains partial because it stages only `file://` artifacts selected from the previously verified signed manifest. Network artifact download still needs a host-owned transport policy, TLS/proxy behavior, progress and cancellation state, and durable terminal failure reporting before it can be marked supported.

`Updater.install` remains partial because it commits the staged artifact into the host-owned updater bundle path. It does not yet perform OS-specific app replacement, rollback execution, process relaunch, or installer handoff.

`Updater.installAndRestart` remains partial because it adds a renderer readiness handshake and restart breadcrumb to the staged install, but it does not relaunch the process into the installed update.

## Methods

| Method              | Payload                                           | Success                                                    | Current support |
| ------------------- | ------------------------------------------------- | ---------------------------------------------------------- | --------------- |
| `check`             | `{ currentVersion?, manifestJson, trustAnchors }` | `{ available: boolean, version?: string, notes?: string }` | supported       |
| `download`          | `{ version? }`                                    | updater status result                                      | partial         |
| `install`           | `{ version? }`                                    | updater status result                                      | partial         |
| `installAndRestart` | `{ version? }`                                    | updater status result                                      | partial         |
| `getStatus`         | `void`                                            | updater status result                                      | supported       |
| `readyForRestart`   | `void`                                            | `void`                                                     | supported       |

## Types

`UpdaterCheckOptions`, `UpdaterDownloadOptions`, `UpdaterInstallOptions`.

`manifestJson` and `trustAnchors` are required for `check`. Each trust anchor has `{ keyVersion, publicKey }`, where `publicKey` is an `ed25519:<base64>` public key envelope.

## Errors

`UpdaterError` is the host protocol error union. Unsupported update lifecycle calls fail as typed `Unsupported` host operations rather than claiming update security.

`Updater.check` emits `UpdateSignatureInvalid` for missing, invalid, tampered, or untrusted manifest signatures. Malformed manifests and malformed trust anchors are `InvalidArgument`.

`Updater.download` requires a prior successful signed-manifest check for a newer version. It supports only current-platform `file://` artifacts from that verified manifest. Missing prior check is `InvalidState`; a requested version that does not match the verified manifest is `NotFound`; non-file artifact URLs are `Unsupported`; truncated artifacts are `UpdateDownloadTruncated`; digest mismatches are `UpdateSignatureInvalid`.

`Updater.install` requires a prior staged artifact. Missing staged state is `InvalidState`; version mismatch is `NotFound`; filesystem commit failures are typed host failures with staging diagnostics. The staged artifact remains on disk until cleanup so diagnostics and rollback metadata remain available.

`Updater.installAndRestart` has the same staged-artifact requirement, then emits `Updater.PreparingRestart` with a deadline. `Updater.readyForRestart` requires a pending restart handshake and records the acknowledgement in host status. Late readiness is a terminal host error with a recovery breadcrumb from the native updater primitive.

`Updater.getStatus` is limited to signed-manifest check, local artifact staging, local install commit, and restart-readiness state. It does not report feed polling, network download, process relaunch, or rollback execution yet.

## Production checks

The current workflow helper can rely on the host for signed manifest verification, local file artifact staging, local staged install commit, and restart-readiness acknowledgement. Do not use it as a production updater until feed policy, network download, process relaunch, permission/audit policy, lifecycle events, and operational diagnostics are complete.

Do not reuse `Updater` as a general download API. General downloads need their own native service and host state machine so interrupted transfers emit terminal events and remain visible to leak/resource inspection.

## Related

- Tutorial: [Package, sign, and ship](../../tutorials/04-package-and-sign.md)
- How-to: [Ship an update](../../how-to/ship-an-update.md)
- Source: [`packages/native/src/updater.ts`](../../../packages/native/src/updater.ts)
