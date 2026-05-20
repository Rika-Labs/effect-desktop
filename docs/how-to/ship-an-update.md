---
title: How to prepare a signed update
description: Publish a signed update manifest for the planned runtime updater.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to prepare a signed update

Updates are designed to use signed manifests with Ed25519 keys. The CLI can publish update metadata, but the runtime `Updater` host adapter is not implemented yet, so the current native surface must not be used as production update verification or installation.

## 1. Generate keys (once)

```bash
openssl genpkey -algorithm Ed25519 -out updater-private.pem
openssl pkey -in updater-private.pem -pubout -out updater-public.pem
```

Add to `desktop.config.ts`:

```ts
publishing: {
  keyVersion: 1,
  privateKeyPath: process.env.UPDATER_KEY_PATH,    // path to updater-private.pem
  publicKeys: [process.env.UPDATER_PUBLIC_KEY]      // contents of updater-public.pem
}
```

The public key gets embedded in the app at build time. The private key signs manifests at publish time.

## 2. Publish the manifest

```bash
bun run desktop publish --config desktop.config.ts --channel stable
```

Produces a signed `update-manifest.json` (one per channel). The manifest binds:

- App id and version.
- Channel name (`stable`, `beta`, etc.).
- Per-target artifact url, hash, size.
- Signature over all of the above.
- Key version.

Upload the manifest and artifacts to your distribution host (S3, Cloudflare R2, GitHub Releases, your own CDN). The framework doesn't care where they live.

## 3. Runtime updater status

The runtime updater is not executable yet. `UpdaterRpcs` and `UpdaterHandlersLive` describe the planned surface, but the Rust host does not verify manifests, download artifacts, install updates, or restart the app.

Do not wire `UpdaterRpcs` into production apps until #1331 is implemented. The eventual manifest shape is expected to look like this:

```ts
import { Desktop } from "@effect-desktop/core"

export const App = Desktop.make({
  id: "dev.example.notes",
  windows: { main: { title: "Notes" } }
})

// Updater configuration (feedUrl, channel, publicKeys, pollIntervalMs) is
// declared in desktop.config.ts under the `publishing` and `updater` sections;
// runtime consumption is planned for UpdaterHandlersLive once the host adapter exists.
```

`feedUrl` will substitute `{channel}` once the host updater exists. Polling and on-demand checks are planned behavior, not current runtime behavior.

## 4. Renderer trigger

The intended runtime contract is to verify the manifest signature against the embedded public key before downloading anything. The current host adapter is not implemented, so bad-signature handling and install prevention are not executable yet.

## 5. Rollback

A manifest can declare a downgrade-allowed flag per channel. By default, downgrade is rejected. To explicitly roll a channel back, publish a new manifest with the older version and `allowDowngrade: true`.

## Channels

The `channel` flag on `publish` lets you ship to `beta`, `nightly`, etc. without disturbing `stable`. Users on `stable` only see manifests at `https://updates.example.com/stable/manifest.json`; users on `beta` follow `/beta/manifest.json`. Each channel has its own version-monotonicity check.

## Why signed manifests

Three properties:

- **Authenticity.** Only manifests signed by your key install. A compromised CDN can't push malware to users.
- **Integrity.** Each artifact entry includes a hash. A tampered binary fails the hash check post-download.
- **Auditability.** Every install emits an audit event with key version, channel, version, and outcome.

## Related

- Reference: [`Updater`](../reference/native/updater.md), [CLI commands](../reference/cli.md)
- Tutorial: [Package, sign, and ship](../tutorials/04-package-and-sign.md)
- How-to: [Sign and notarize](sign-and-notarize.md)
