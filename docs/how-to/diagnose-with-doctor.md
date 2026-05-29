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

The doctor command checks every prerequisite for every release step on the current platform. It returns a Schema-typed `DesktopDoctorReport` — `{ passed, ci, platform, arch, probes: Array<{ name, status, component, message, evidence, ... }>, layerGraph }` — and prints a status table. The top-level `passed` boolean drives the non-zero exit.

## What it checks

Doctor runs ten probes in order. The probe `name` field uses these exact identifiers:

| Probe                   | What it verifies                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `bun-version`           | Installed Bun version meets the workspace's pinned `package.json#packageManager` floor                         |
| `rust-toolchain`        | `cargo` and `rustc` resolve and respond to `--version`                                                         |
| `platform-sdk`          | Host SDK present: `xcode-select -p` (macOS), `where cl` (Windows), `pkg-config webkit2gtk-4.1` (Linux)         |
| `webview-runtime`       | System WebView present (always OK on macOS; reads `EdgeUpdate` registry on Windows; `webkit2gtk-4.1` on Linux) |
| `signing-credentials`   | Per-platform signing config is present (warning when missing, not a failure)                                   |
| `build-tools`           | `hdiutil` (macOS), `wix` (Windows), or `dpkg-deb` (Linux) responds                                             |
| `package-manager-state` | `package.json#packageManager` is pinned to Bun and `bun.lock` exists                                           |
| `native-capabilities`   | The bundled native parity matrix decodes and reports zero missing host routes                                  |
| `native-host-cache`     | `target/debug/host` (or `host.exe`) exists; warning when missing                                               |
| `config`                | `desktop.config.ts` loads, stays inside the workspace, and supplies required app metadata                      |

Doctor fails with `DoctorCapabilityTruthUnavailable` (not a probe warning) when the bundled parity matrix is missing or invalid — that is a CLI build defect.

## Reading the output

```
ORIKA doctor
platform          darwin-arm64
ci                no
result            ok
[OK] bun-version: Bun 1.3.13 satisfies 1.3.13
[OK] rust-toolchain: cargo and rustc are available
[WARN] signing-credentials: signing credentials are not configured; unsigned local packages remain allowed
[OK] native-capabilities: native capability matrix reports 286 methods, 238 host-routed, 0 missing host routes
```

Each row maps to one probe. `missing` probes fail the gate with a non-zero exit. Warnings are advisory, but a `native-capabilities` warning means some declared native methods still lack host routes. The exact counts come from the parity matrix bundled with the CLI (`packages/cli/src/native-parity-matrix.json`) and stay in sync with [`reference/native/parity-matrix.md`](../reference/native/parity-matrix.md).

## When to run it

- Before your first release of the day.
- When the package or sign step fails strangely.
- After upgrading Bun, Rust, or Xcode.
- In CI as the first step of release jobs.

## Programmatic use

```ts
import { Effect } from "effect"
import { runDesktopDoctor, type DoctorCommandRunner } from "@orika/cli"

// Supply a runner that executes each probe command and returns its output.
const commandRunner: DoctorCommandRunner = (invocation) =>
  Effect.gen(function* () {
    const proc = Bun.spawnSync({
      cmd: [invocation.command, ...invocation.args],
      cwd: invocation.cwd
    })
    return {
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString()
    }
  })

const report = await Effect.runPromise(
  runDesktopDoctor({
    cwd: process.cwd(),
    configPath: "desktop.config.ts",
    ci: false,
    platform: process.platform,
    arch: process.arch,
    bunVersion: Bun.version,
    commandRunner
  })
)
const missing = report.probes.filter((probe) => probe.status === "missing")
```

Useful in CI to bail out early with a structured report.

## Related

- Reference: [CLI commands](../reference/cli.md)
- How-to: [Package for macOS](package-for-macos.md), [Sign and notarize](sign-and-notarize.md)
- Tutorial: [Package, sign, and ship](../tutorials/04-package-and-sign.md)
