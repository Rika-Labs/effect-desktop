---
title: How to ship an update
description: Publish a signed update manifest and wire the runtime updater to consume it.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to ship an update

Updates use signed manifests with Ed25519 keys. The CLI publishes; the runtime `Updater` service verifies and applies. There is no opaque "update server" — you host the manifest and artifacts yourself.

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

## 3. Configure the runtime updater

In your manifest:

```ts
import { Desktop } from "@effect-desktop/core"
import { UpdaterRpcs } from "@effect-desktop/native"

export const App = Desktop.make({
  id: "dev.example.notes",
  windows: { main: { title: "Notes" } },
  rpcs: [
    { group: UpdaterRpcs, handlers: UpdaterHandlersLive }
  ]
})

// Updater configuration (feedUrl, channel, publicKeys, pollIntervalMs) is
// declared in desktop.config.ts under the `publishing` and `updater` sections;
// the runtime UpdaterHandlersLive layer reads it at startup.
```

`feedUrl` substitutes `{channel}`. The updater polls per `pollIntervalMs` (or on demand).

## 4. Trigger from the renderer

```tsx
import { UpdaterRpcs } from "@effect-desktop/native"

function CheckForUpdates() {
  const updater = DesktopApp.useDesktop(UpdaterRpcs)
  const check = updater.check.useMutation()
  const download = updater.download.useMutation()
  const install = updater.install.useMutation()

  const onCheck = async () => {
    const result = await check.run({})
    if (result.available) {
      await download.run({ version: result.version })
      await install.run({ version: result.version })
    }
  }

  return <button onClick={onCheck}>Check for updates</button>
}
```

The runtime verifies the manifest signature against the embedded public key before downloading anything. A bad signature returns `UpdaterError.SignatureInvalid` — no install happens.

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
