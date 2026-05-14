---
title: CLI commands
description: Every desktop subcommand with flags and reports.
kind: reference
audience: app-developers
effect_version: 4
---

# CLI commands

`@effect-desktop/cli` is the developer CLI. Run it via `bun run desktop <command>` from the repo root, or import the typed runners directly.

## Import (programmatic)

```ts
import {
  runCli,
  runDesktopBuild,
  runDesktopCheck,
  runDesktopPackage,
  runDesktopSign,
  runDesktopNotarize,
  runDesktopPublish,
  runDesktopReproCheck,
  runDesktopDoctor,
  runReleaseWorkflow
} from "@effect-desktop/cli"
```

`runCli({ argv, cwd, writeStdout, writeStderr })` is the top-level entry point — wraps every subcommand and their flag parsing.

## Commands

| Command                                   | Description                                 |
| ----------------------------------------- | ------------------------------------------- |
| `desktop --help`                          | Top-level help                              |
| `desktop check`                           | Run production security checks              |
| `desktop check --docs`                    | Run the documentation release gate          |
| `desktop check --repro --baseline <path>` | Reproducibility check against a prior build |
| `desktop build`                           | Build renderer and runtime                  |
| `desktop package`                         | Stage platform artifacts                    |
| `desktop sign`                            | Sign artifacts                              |
| `desktop notarize`                        | Notarize macOS artifacts (Apple)            |
| `desktop publish`                         | Publish signed update manifest              |
| `desktop release`                         | Run the full release workflow               |
| `desktop doctor`                          | Diagnose environment prerequisites          |

## Common flags

| Flag               | Description                                                         |
| ------------------ | ------------------------------------------------------------------- |
| `--config <path>`  | Path to `desktop.config.ts` (default: cwd)                          |
| `--target <a,b>`   | Restrict to specific build targets (e.g. `macos-arm64,windows-x64`) |
| `--channel <name>` | Update channel for `publish`                                        |

## `runDesktopCheck(options) → ProductionCheckReport`

```ts
const report = await Effect.runPromise(runDesktopCheck({ cwd: process.cwd() }))
if (!report.passed) {
  for (const v of report.violations) {
    console.error(`${v.rule}: ${v.message}`)
  }
}
```

## `runDesktopBuild(options) → DesktopBuildReport`

Returns `{ layout, elapsed, artifacts }`.

## `runDesktopPackage(options) → DesktopPackageReport`

Returns `{ artifacts: [{ path, kind, size, hash }, ...] }`.

## `runDesktopSign(options) → DesktopSignReport`

Returns `{ artifacts: [{ path, signed, error? }, ...] }`.

## `runDesktopNotarize(options) → DesktopNotarizeReport`

Returns `{ artifacts: [{ path, stapled, error? }, ...] }`.

## `runDesktopPublish(options)`

Returns the signed manifest plus distribution metadata.

## `runDesktopReproCheck(options)`

Returns either the diff report (failure) or success.

## `runDesktopDoctor(options) → DoctorReport`

Returns `{ checks: [{ name, status, message? }, ...] }`. Check `report.checks.every(c => c.status !== "failed")` to gate.

## `runReleaseWorkflow(config, services)`

Runs the full release sequence (check → build → package → sign → notarize → publish) with telemetry and resume-on-failure.

## Error types

Each command exports a closed error union:

- `PackagePipelineError` — `PackageCommandFailedError`, `PackageConfigError`, `PackageFileError`, `PackageMissingBuildArtifactError`, `PackageUnsupportedArtifactError`, `PackageUnsupportedHostError`, `PackageUnsupportedTargetError`.
- `SignPipelineError` — similar shape for signing.
- `NotarizePipelineError`, `PublishPipelineError`, `ReproCheckPipelineError` — for their phases.

## Format helpers

Each report has a matching formatter:

```ts
import { formatPackageReport, formatSignReport, formatDoctorReport } from "@effect-desktop/cli"

console.log(formatPackageReport(report))
```

## Related

- Tutorial: [Package, sign, and ship](../tutorials/04-package-and-sign.md)
- How-to: [Diagnose with doctor](../how-to/diagnose-with-doctor.md)
- Source: [`packages/cli/src/index.ts`](../../packages/cli/src/index.ts)
