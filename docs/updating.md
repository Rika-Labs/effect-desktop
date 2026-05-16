---
title: Updating
description: Signed update manifests with Ed25519 keys.
kind: reference
audience: app-developers
effect_version: 4
---

# Updating

> Full references: [`reference/cli.md`](reference/cli.md), [`reference/native/updater.md`](reference/native/updater.md). How-to: [`ship an update`](how-to/ship-an-update.md).

Updates use signed manifests and client-side verification. The CLI publishes update metadata; native updater crates verify and apply updates.

## CLI

```bash
bun run desktop publish --config desktop.config.ts
```

The publish command owns canonical update-manifest JSON and Ed25519 signing.

## Runtime surface

`@effect-desktop/native` exports `Updater`, `UpdaterRpcs`, updater clients, service layers, and update workflow helpers.

## Verify Update Exports

```ts run
import { runDesktopPublish } from "../packages/cli/src/index.js"

const manifestType = "UpdateManifest"

if (typeof runDesktopPublish !== "function" || manifestType.length === 0) {
  throw new Error("runDesktopPublish or UpdateManifest is unavailable")
}
```

## Rule

Signed manifests bind **version, channel, artifact identity, checksums, and key version**. Rollback and downgrade policy must be explicit.

## Where to go next

- [How-to: ship an update](how-to/ship-an-update.md)
- [`Updater` reference](reference/native/updater.md)
- [Tutorial: package, sign, and ship](tutorials/04-package-and-sign.md)
