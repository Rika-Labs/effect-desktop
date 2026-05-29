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

`--platform` takes one desktop target id (`macos-arm64` or `macos-x64`). Run the command once per target you ship. `desktop package` stages an unsigned `.app` bundle and its `Info.plist` for that target. Hardened runtime and entitlements are applied later by `desktop sign`.

## What the bundle contains

```
Notes.app/
├── Contents/
│   ├── Info.plist
│   ├── MacOS/
│   │   └── Notes               # native launcher
│   └── Resources/
│       └── effect-desktop/
│           ├── runtime/         # TypeScript runtime entry + dependencies
│           └── renderer/        # built renderer assets
└── ...
```

Defaults are computed from your `desktop.config.ts`:

- `Info.plist` — bundle id from `app.id`, version from `app.version`.

The v1 packager does not embed a custom icon.

## Entitlements

Add your signing identity to `desktop.config.ts`:

```ts
signing: {
  macos: {
    identity: "Developer ID Application: Your Name (TEAMID)"
  }
}
```

`signing.macos.identity` is the only macOS signing key the pipeline reads. The entitlements plist is generated automatically from the app's declared permissions and written as `effect-desktop-entitlements.plist`, then passed to `codesign`.

## Sign

```bash
bun run desktop sign --config desktop.config.ts --platform macos-arm64
```

This step applies the hardened runtime and the generated entitlements. For each path it invokes `codesign --force --sign "<your identity>" --options runtime --entitlements effect-desktop-entitlements.plist <path>`. It signs the nested Mach-O binaries first (under `MacOS/`, `Resources/effect-desktop/native`, and `Resources/effect-desktop/runtime`), then the bundle itself.

If `signing.macos.identity` is not configured, the sign step fails with `SignConfigError`. If a configured identity is absent from the keychain, `codesign` exits non-zero and the step fails with `SignCommandFailedError` carrying the codesign stderr. Run `security find-identity -v -p codesigning` to list available identities.

## Notarize

```bash
bun run desktop notarize --config desktop.config.ts --platform macos-arm64
```

Requires `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_SPECIFIC_PASSWORD` (an app-specific password from appleid.apple.com). Alternatively, use a keychain profile via `signing.macos.notarytoolProfile` / `APPLE_NOTARYTOOL_PROFILE`, or configure `signing.macos.appleId`, `signing.macos.teamId`, and `signing.macos.passwordEnv`. The CLI calls `xcrun notarytool submit` and waits for the result.

On success, `xcrun stapler staple Notes.app` attaches the notarization ticket so offline machines can verify it.

## Verify locally

```bash
spctl -a -vvv -t install Notes.app
codesign -dv --verbose=4 Notes.app
```

Both should succeed. If `spctl` complains about notarization, the staple did not attach — re-run notarize.

## Common failures

| Failure                                    | Cause                                 | Fix                                                                          |
| ------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------- |
| `errSecInternalComponent`                  | Keychain locked                       | `security unlock-keychain ~/Library/Keychains/login.keychain-db`             |
| Identity not found                         | Wrong identity name                   | `security find-identity -v -p codesigning`                                   |
| Notarization rejected: missing entitlement | Hardened runtime needs an entitlement | Declare the matching permission so it is added to the generated entitlements |
| Staple fails                               | Notarization rejected before stapling | Read the notary log via `xcrun notarytool log <id>`                          |

`bun run desktop doctor` runs the macOS-specific prerequisite checks: Xcode command-line tools (`xcode-select -p`), packaging build tools (`hdiutil`), and a signing-credentials check that warns if signing config is absent.

## Related

- Tutorial: [Package, sign, and ship](../tutorials/04-package-and-sign.md)
- How-to: [Sign and notarize](sign-and-notarize.md), [Diagnose with doctor](diagnose-with-doctor.md)
- Reference: [CLI commands](../reference/cli.md)
