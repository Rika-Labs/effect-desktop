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

Add to `desktop.config.ts` under `update`:

```ts
update: {
  channel: "stable",                                // "stable" | "beta" | "canary"
  feedUrl: "https://updates.example.com/{platform}/{channel}.json",
  publicKey: "ed25519:<base64-public-key>",         // contents of updater-public.pem (Ed25519 envelope)
  privateKeyEnv: "UPDATER_PRIVATE_KEY_PEM",         // env var holding the private key PEM at publish time
  keyVersion: 1
}
```

The public key envelope ships in the app for trust anchoring. `privateKeyEnv` is the **name** of the environment variable the CLI reads the private key PEM from at publish time — never the key itself. `feedUrl` must contain both `{platform}` and `{channel}` placeholders.

## 2. Publish the manifest

```bash
bun run desktop publish --config desktop.config.ts
```

There is no `--channel` flag. The channel comes from `update.channel` in `desktop.config.ts`. To ship multiple channels, run `publish` once per channel with different config files (or override the field in profile overrides).

The signed `update-manifest.json` is canonical JSON (sorted keys, deterministic whitespace) so the Ed25519 signature is reproducible. The manifest binds:

- App id and version.
- Channel name.
- Per-target artifact url, SHA-256, byte size.
- Ed25519 signature over the canonical bytes.
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

// Updater configuration (feedUrl, channel, publicKey, privateKeyEnv,
// keyVersion) is declared in desktop.config.ts under the `update` section.
// Feed polling and policy enforcement are still application-owned.
```

`feedUrl` will substitute `{channel}` for published manifests. Host-owned polling and on-demand feed checks are planned behavior, not current runtime behavior.

## 4. Renderer trigger

The current host check contract verifies the manifest signature against caller-supplied public keys before any updater state advances. Bad signatures fail with `UpdateSignatureInvalid`; malformed manifests and malformed trust anchors fail with `InvalidArgument`.

## 5. Rollback

A manifest can declare a rollback pack per channel. To explicitly roll a channel back, publish a new manifest with the older version, `rollback: true`, and `maxVersion` set to the highest installed version that should accept the rollback pack.

## Channels

`update.channel` in `desktop.config.ts` is one of `stable`, `beta`, or `canary`. Each channel resolves through the `{channel}` placeholder in `update.feedUrl`, so users on `stable` and `beta` follow distinct manifest URLs. Publish validates only the internal consistency of `update.minVersion`, `update.maxVersion`, and `app.version` (and the rollback rule that `maxVersion` is set when `rollback: true`); it does not compare against any previously published version.

## Why signed manifests

Three properties:

- **Authenticity.** Only manifests signed by your key install. A compromised CDN can't push malware to users.
- **Integrity.** Each artifact entry includes a hash. A tampered binary fails the hash check post-download.
- **Auditability.** Signed metadata records key version, channel, version, and artifact digests; runtime install audit event emission remains part of the unfinished production updater work.

## Related

- Reference: [`Updater`](../reference/native/updater.md), [CLI commands](../reference/cli.md)
- Tutorial: [Package, sign, and ship](../tutorials/04-package-and-sign.md)
- How-to: [Sign and notarize](sign-and-notarize.md)
