---
title: How to sign and notarize
description: Apply platform signatures and (on macOS) Apple notarization to your build artifacts.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to sign and notarize

Sign and notarize are two CLI steps. They run after `desktop package`. Both produce typed reports.

## Sign

```bash
bun run desktop sign --config desktop.config.ts
```

Per platform:

| Platform | Tool | Required config |
| --- | --- | --- |
| macOS | `codesign` | `signing.macos.identity` |
| Windows | `signtool` | `signing.windows.certificateThumbprint` |
| Linux | `gpg` (optional) | `signing.linux.gpgKey` |

The CLI invokes the platform tool with the right arguments. Windows additionally handles the PowerShell unblock for downloaded binaries.

### Inspect the report

`runDesktopSign` returns a `DesktopSignReport`:

```
{
  artifacts: [
    { path: "dist/macos-arm64/Notes.app", signed: true },
    { path: "dist/windows-x64/Notes.exe", signed: true }
  ]
}
```

A `signed: false` row carries an `error` describing the failure (missing identity, expired cert, locked keychain).

### Sign one platform at a time

```bash
bun run desktop sign --target macos-arm64
```

Useful when iterating on a single platform.

## Notarize (macOS)

```bash
bun run desktop notarize --config desktop.config.ts
```

Requires three environment variables:

- `APPLE_ID` — your Apple ID email.
- `APPLE_TEAM_ID` — your developer team id (10-character string).
- `APPLE_APP_PASSWORD` — an app-specific password from appleid.apple.com, **not** your Apple ID password.

The CLI:

1. Submits each signed `.app` to Apple via `xcrun notarytool submit --wait`.
2. Waits for the result (typically 5-15 minutes).
3. On success, runs `xcrun stapler staple Notes.app` to attach the ticket.

### The report

`runDesktopNotarize` returns a `DesktopNotarizeReport`:

```
{
  artifacts: [
    { path: "dist/macos-arm64/Notes.app", stapled: true },
    { path: "dist/macos-x64/Notes.app", stapled: false, error: "rejected: missing entitlement com.apple.security.cs.allow-jit" }
  ]
}
```

For a rejected submission, fetch the full notary log:

```bash
xcrun notarytool log <submission-id> --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD"
```

## Verify

After signing and stapling, verify the artifact:

```bash
spctl -a -vvv -t install Notes.app    # macOS Gatekeeper check
codesign --verify --verbose Notes.app  # signature integrity
signtool verify /pa /v Notes.exe       # Windows
```

`bun run desktop doctor` includes signing prerequisite checks for the host platform.

## Related

- Tutorial: [Package, sign, and ship](../tutorials/04-package-and-sign.md)
- How-to: [Package for macOS](package-for-macos.md), [Diagnose with doctor](diagnose-with-doctor.md)
- Reference: [CLI commands](../reference/cli.md)
