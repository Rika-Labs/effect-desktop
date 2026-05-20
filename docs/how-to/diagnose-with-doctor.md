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

The doctor command checks every prerequisite for every release step on the current platform. It returns a Schema-typed `DesktopDoctorReport` — `{ probes: Array<{ name, status, message, evidence }> }` — and prints a status table.

## What it checks

Always:

- Bun version matches `package.json#packageManager`.
- Rust toolchain is available.
- Platform SDK and WebView runtime are available for the current host.
- Signing credentials are configured when needed.
- Build tools are available.
- Package manager state is Bun-pinned with a lockfile.
- Native capability truth is available from the generated parity matrix.
- Native host build cache is present when packaging.
- Desktop config has required app metadata.

Per-platform:

| Platform | Additional checks                                   |
| -------- | --------------------------------------------------- |
| macOS    | Xcode CLI tools, system WebView runtime, `hdiutil`  |
| Windows  | Visual Studio build tools, WebView2 runtime, WiX    |
| Linux    | `webkit2gtk-4.1`, `dpkg-deb`, package manager state |

If you've set release-related environment variables (`APPLE_ID`, `WINDOWS_CERT_THUMBPRINT`, `UPDATER_KEY_PATH`), the doctor verifies they point at something usable.

## Reading the output

```
Effect Desktop doctor
platform          darwin-arm64
ci                no
result            ok
[OK] bun-version: Bun 1.3.13 satisfies 1.3.13
[OK] rust-toolchain: cargo and rustc are available
[WARN] signing-credentials: signing credentials are not configured; unsigned local packages remain allowed
[OK] native-capabilities: native capability matrix reports 291 methods, 229 host-routed, 0 missing host routes
```

Each row maps to one probe. `missing` probes fail the gate with a non-zero exit. Warnings are advisory, but a `native-capabilities` warning means some declared native methods still lack host routes.

## When to run it

- Before your first release of the day.
- When the package or sign step fails strangely.
- After upgrading Bun, Rust, or Xcode.
- In CI as the first step of release jobs.

## Programmatic use

```ts
import { Effect } from "effect"
import { runDesktopDoctor, runDoctorCommand } from "@effect-desktop/cli"

const report = await Effect.runPromise(
  runDesktopDoctor({
    cwd: process.cwd(),
    configPath: "desktop.config.ts",
    ci: false,
    platform: process.platform,
    arch: process.arch,
    bunVersion: Bun.version,
    commandRunner: runDoctorCommand
  })
)
const missing = report.probes.filter((probe) => probe.status === "missing")
```

Useful in CI to bail out early with a structured report.

## Related

- Reference: [CLI commands](../reference/cli.md)
- How-to: [Package for macOS](package-for-macos.md), [Sign and notarize](sign-and-notarize.md)
- Tutorial: [Package, sign, and ship](../tutorials/04-package-and-sign.md)
