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

| Platform | Tool             | Required config                         |
| -------- | ---------------- | --------------------------------------- |
| macOS    | `codesign`       | `signing.macos.identity`                |
| Windows  | `signtool`       | `signing.windows.certificateThumbprint` |
| Linux    | `gpg` (optional) | `signing.linux.gpgKey`                  |

The CLI invokes the platform tool with the right arguments. Windows additionally handles the PowerShell unblock for downloaded binaries.

### Inspect the report

`runDesktopSign` returns a `DesktopSignReport`. Each `artifact` row carries `{ kind, artifactPath, signedPaths, signaturePath? }`:

```
{
  appId: "dev.example.notes",
  appName: "Notes",
  appVersion: "1.2.3",
  target: "macos-arm64",
  outputPath: "dist/desktop/macos",
  artifacts: [
    {
      kind: "app",
      artifactPath: "dist/desktop/macos/Notes.app",
      signedPaths: ["dist/desktop/macos/Notes.app"]
    }
  ],
  steps: [/* SignStepReport rows */]
}
```

Signing failures fail the effect with a typed `SignPipelineError` variant (`SignConfigError`, `SignCommandFailedError`, etc.); they are not encoded as `signed: false` rows.

### Sign one platform at a time

```bash
bun run desktop sign --platform macos-arm64
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

`runDesktopNotarize` returns a `DesktopNotarizeReport`. Each `artifact` row carries `{ kind, artifactPath, alreadyStapled, submissionId?, status?, assessed }`:

```
{
  target: "macos-arm64",
  outputPath: "dist/desktop/macos",
  artifacts: [
    {
      kind: "app",
      artifactPath: "dist/desktop/macos/Notes.app",
      alreadyStapled: false,
      submissionId: "abcd-1234-...",
      status: "Accepted",
      assessed: true
    }
  ],
  steps: [/* NotarizeStepReport rows */]
}
```

Rejections fail the effect with `NotarizeCommandFailedError`. For a rejected submission, fetch the full notary log:

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
