---
title: How to prepare a signed update
description: Publish a signed update manifest and use the current partial runtime updater.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to prepare a signed update

Updates use signed manifests with Ed25519 keys. The CLI publishes update metadata, and the runtime `Updater` has an executable local subset: signed-manifest verification, local file artifact staging, staged install commit, and restart readiness. The remaining production updater work is feed polling, network artifact download, production update policy, OS app replacement, process relaunch, and rollback execution.

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

The runtime updater's executable local subset starts at `Updater.check`, which verifies caller-supplied signed manifest JSON against caller-supplied Ed25519 trust anchors. Follow-on lifecycle calls are still partial and limited to host-owned local file staging, staged install commit, and restart readiness; the host does not fetch feeds, download network artifacts, enforce production update policy, replace the installed application bundle, run rollback execution, or relaunch the app yet.

Do not wire `UpdaterRpcs` into production apps until the remaining updater lifecycle is complete. The manifest wiring is expected to look like this:

```ts
import { Desktop } from "@orika/core"

export const App = Desktop.make({
  id: "dev.example.notes",
  windows: Desktop.window("main", { title: "Notes" })
})

// Updater configuration (feedUrl, channel, publicKeys, pollIntervalMs) is
// declared in desktop.config.ts under the `publishing` and `updater` sections.
// Feed polling and policy enforcement are still application-owned.
```

`feedUrl` will substitute `{channel}` for published manifests. Host-owned polling and on-demand feed checks are planned behavior, not current runtime behavior.

## 4. Renderer trigger

The current host check contract verifies the manifest signature against caller-supplied public keys before any updater state advances. Bad signatures fail with `UpdateSignatureInvalid`; malformed manifests and malformed trust anchors fail with `InvalidArgument`.

## 5. Rollback

A manifest can declare a rollback pack per channel. By default, non-newer versions are rejected. To explicitly roll a channel back, publish a new manifest with the older version, `rollback: true`, and `maxVersion` set to the highest installed version that should accept the rollback pack.

## Channels

The `channel` flag on `publish` lets you ship to `beta`, `nightly`, etc. without disturbing `stable`. Users on `stable` only see manifests at `https://updates.example.com/stable/manifest.json`; users on `beta` follow `/beta/manifest.json`. Each channel has its own version-monotonicity check.

## Why signed manifests

Three properties:

- **Authenticity.** Only manifests signed by your key install. A compromised CDN can't push malware to users.
- **Integrity.** Each artifact entry includes a hash. A tampered binary fails the hash check post-download.
- **Auditability.** Signed metadata records key version, channel, version, and artifact digests; runtime install audit event emission remains part of the unfinished production updater work.

## Related

- Reference: [`Updater`](../reference/native/updater.md), [CLI commands](../reference/cli.md)
- Tutorial: [Package, sign, and ship](../tutorials/04-package-and-sign.md)
- How-to: [Sign and notarize](sign-and-notarize.md)
