---
title: How to diagnose with doctor
description: Run the doctor command to find missing prerequisites and broken environment.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to diagnose with doctor

```bash
bun run desktop doctor
```

The doctor command checks every prerequisite for every release step on the current platform. It returns a typed `DoctorReport` — `{ checks: Array<{ name, status, message? }> }` — and prints a green/red table.

## What it checks

Always:

- Bun version matches `package.json#packageManager`.
- Rust toolchain matches `rust-toolchain.toml`.
- Workspace dependencies installed (`bun install` was run with `--frozen-lockfile`).
- TypeScript can resolve the public packages.

Per-platform:

| Platform | Additional checks                                                                               |
| -------- | ----------------------------------------------------------------------------------------------- |
| macOS    | Xcode CLI tools, codesign available, notarytool available, signing identity present in keychain |
| Windows  | Visual Studio build tools, signtool available, certificate thumbprint resolvable                |
| Linux    | gcc, libgtk-3, libwebkit2gtk, AppImage tools                                                    |

If you've set release-related environment variables (`APPLE_ID`, `WINDOWS_CERT_THUMBPRINT`, `UPDATER_KEY_PATH`), the doctor verifies they point at something usable.

## Reading the output

```
Effect Desktop doctor

bun                            ok       1.3.13
rust toolchain                 ok       (per rust-toolchain.toml)
workspace install              ok
codesign                       ok       /usr/bin/codesign
signing identity               failed   identity "Developer ID Application: ..." not found in keychain
notarytool                     ok       /Applications/Xcode.app/Contents/Developer/usr/bin/notarytool
APPLE_ID                       ok
APPLE_APP_PASSWORD             ok
APPLE_TEAM_ID                  warning  set but contains spaces
```

Each row maps to one check. Failures fail the gate (non-zero exit). Warnings are advisory.

## When to run it

- Before your first release of the day.
- When the package or sign step fails strangely.
- After upgrading Bun, Rust, or Xcode.
- In CI as the first step of release jobs.

## Programmatic use

```ts
import { runDesktopDoctor } from "@effect-desktop/cli"

const report = await Effect.runPromise(runDesktopDoctor({ cwd: process.cwd() }))
const failed = report.checks.filter((c) => c.status === "failed")
```

Useful in CI to bail out early with a structured report.

## Related

- Reference: [CLI commands](../reference/cli.md)
- How-to: [Package for macOS](package-for-macos.md), [Sign and notarize](sign-and-notarize.md)
- Tutorial: [Package, sign, and ship](../tutorials/04-package-and-sign.md)
