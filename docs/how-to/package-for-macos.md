---
title: How to package for macOS
description: macOS-specific bundling, entitlements, hardened runtime, and stapling.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to package for macOS

Run the package command for a macOS target:

```bash
bun run desktop package --config desktop.config.ts --platform macos-arm64
```

`--platform` takes one desktop target id (`macos-arm64` or `macos-x64`). Run the command once per target you ship. The CLI stages a `.app` bundle for that target with the framework's default hardened-runtime entitlements.

## What the bundle contains

```
Notes.app/
├── Contents/
│   ├── Info.plist
│   ├── MacOS/
│   │   └── Notes               # native launcher
│   └── Resources/
│       ├── runtime/             # TypeScript runtime entry + dependencies
│       ├── renderer/            # built renderer assets
│       └── icon.icns
└── ...
```

Defaults are computed from your `desktop.config.ts`:

- `Info.plist` — bundle id from `app.id`, version from `app.version`.
- Icon from `assets.macos.icon` (or a default).
- Hardened-runtime flags enabled.

## Customize entitlements

Add to `desktop.config.ts`:

```ts
signing: {
  macos: {
    identity: "Developer ID Application: Your Name (TEAMID)",
    entitlements: {
      "com.apple.security.cs.allow-jit": false,
      "com.apple.security.network.client": true,
      "com.apple.security.files.user-selected.read-write": true
    }
  }
}
```

The CLI generates an `entitlements.plist` from this map and passes it to `codesign`.

## Sign

```bash
bun run desktop sign --config desktop.config.ts --platform macos-arm64
```

The CLI invokes `codesign --deep --options=runtime --identity "<your identity>" --entitlements entitlements.plist Notes.app`.

If the identity isn't found, the sign step fails with `SignConfigError` naming the missing identity. Run `security find-identity -v -p codesigning` to list available identities.

## Notarize

```bash
bun run desktop notarize --config desktop.config.ts --platform macos-arm64
```

Requires `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_PASSWORD` (an app-specific password from appleid.apple.com). The CLI calls `xcrun notarytool submit` and waits for the result.

On success, `xcrun stapler staple Notes.app` attaches the notarization ticket so offline machines can verify it.

## Verify locally

```bash
spctl -a -vvv -t install Notes.app
codesign -dv --verbose=4 Notes.app
```

Both should succeed. If `spctl` complains about notarization, the staple did not attach — re-run notarize.

## Common failures

| Failure                                    | Cause                                 | Fix                                                              |
| ------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------- |
| `errSecInternalComponent`                  | Keychain locked                       | `security unlock-keychain ~/Library/Keychains/login.keychain-db` |
| Identity not found                         | Wrong identity name                   | `security find-identity -v -p codesigning`                       |
| Notarization rejected: missing entitlement | Hardened runtime needs an entitlement | Add to `signing.macos.entitlements`                              |
| Staple fails                               | Notarization rejected before stapling | Read the notary log via `xcrun notarytool log <id>`              |

`bun run desktop doctor` runs all the macOS-specific prerequisite checks (Xcode tools, codesign availability, notarytool credentials, identity presence).

## Related

- Tutorial: [Package, sign, and ship](../tutorials/04-package-and-sign.md)
- How-to: [Sign and notarize](sign-and-notarize.md), [Diagnose with doctor](diagnose-with-doctor.md)
- Reference: [CLI commands](../reference/cli.md)
