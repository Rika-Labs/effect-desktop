---
title: CLI commands
description: Every desktop subcommand with flags and reports.
kind: reference
audience: app-developers
effect_version: 4
---

# CLI commands

`@orika/cli` is the developer CLI. Run it via `bun run desktop <command>` from the repo root, or import the typed runners directly.

## Import (programmatic)

```ts
import {
  runCli,
  runDesktopBuild,
  runDesktopPackage,
  runDesktopSign,
  runDesktopNotarize,
  runDesktopPublish,
  runDesktopReproCheck,
  runDesktopDoctor,
  runReleaseWorkflow
} from "@orika/cli"
```

`runCli({ argv, cwd, writeStdout, writeStderr })` is the top-level entry point — wraps every subcommand and their flag parsing.

## Commands

| Command            | Description                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `desktop --help`   | Top-level help                                                                                                                            |
| `desktop build`    | Build renderer, runtime, native host, bridge manifest, and app manifest into `build/effect-desktop/<target>`                              |
| `desktop package`  | Stage the fixed §23.2 artifact set from an existing build layout                                                                          |
| `desktop sign`     | Sign existing `dist/desktop/<platform>` artifacts and write `sign-report.json`                                                            |
| `desktop notarize` | Submit signed macOS artifacts to Apple notarization, staple tickets, and assess Gatekeeper                                                |
| `desktop publish`  | Publish an Ed25519-signed `update-manifest.json` from packaged release artifacts                                                          |
| `desktop release`  | Run `package`, `sign`, `notarize` when needed, and `publish` as a resumable release workflow                                              |
| `desktop doctor`   | Validate Bun, Rust, platform SDK, WebView runtime, signing credentials, build tools, package manager state, native host cache, and config |
| `desktop check`    | Run production security, reproducibility, public API, docs, release, accessibility, or semver checks (exactly one mode flag per run)      |

## Flags

The CLI rejects unknown flags per command. The matrix below enumerates the exact accepted flags as declared in `packages/cli/src/index.ts`.

| Command    | Flags                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `build`    | `--config <path>` (default `desktop.config.ts`), `--platform <id>`, `--profile <name>` (default `dev`), `--json`                                                                                 |
| `package`  | `--config <path>`, `--platform <id>`, `--artifact <kind>`, `--json`                                                                                                                              |
| `sign`     | `--config <path>`, `--platform <id>`, `--json`                                                                                                                                                   |
| `notarize` | `--config <path>`, `--platform <id>`, `--json`                                                                                                                                                   |
| `publish`  | `--config <path>`, `--platform <id>`, `--json`                                                                                                                                                   |
| `release`  | `--config <path>`, `--platform <id>`, `--artifact <kind>`, `--version <semver>`, `--json`                                                                                                        |
| `doctor`   | `--config <path>`, `--ci`, `--json`                                                                                                                                                              |
| `check`    | One of `--production`, `--repro`, `--api`, `--docs`, `--release`, `--a11y`, `--semver`; plus `--config <path>`, `--renderer <name>`, `--platform <id>`, `--artifact <kind>`, `--write`, `--json` |

`--platform` accepts a desktop target id such as `macos-arm64`, `macos-x64`, `windows-x64`, `linux-x64`, or `linux-arm64`. There is no `--target`, no `--channel`, and no `--baseline` flag — update channel comes from `desktop.config.ts#update.channel`.

`--json` switches every command to a Schema-encoded JSON report on stdout (success) or stderr (failure). The check command modes are mutually exclusive; combining two (e.g. `--repro --api`) is a usage error.

## `runDesktopBuild(options) → DesktopBuildReport`

Returns `{ appId, appName, appVersion, target, providers, providerBudgets, providerMeasurements, layoutPath, appManifestPath, bridgeManifestPath, steps }`. Each step report carries `{ name, command?, cwd?, elapsedMs, outputPath, provider?, cacheKey, status: "rebuilt" | "reused", reason }`.

## `runDesktopPackage(options) → DesktopPackageReport`

Returns `{ appId, appName, appVersion, target, layoutPath, outputPath, providers, artifacts, steps }`. Each artifact report carries `{ kind, target, artifactPath, artifactJsonPath, checksumsPath, appId, appName, appVersion, sizeBytes, sha256, linuxIntegration? }`.

## `runDesktopSign(options) → DesktopSignReport`

Returns `{ appId, appName, appVersion, target, outputPath, artifacts, steps }`. Each artifact report carries `{ kind, artifactPath, signedPaths, signaturePath? }`. Signing failures fail the effect with a `SignPipelineError` variant rather than encoding `signed: false` on the row.

## `runDesktopNotarize(options) → DesktopNotarizeReport`

Returns `{ appId, appName, appVersion, target, outputPath, artifacts, steps }`. Each artifact report carries `{ kind, artifactPath, alreadyStapled, submissionId?, status?, assessed }`.

## `runDesktopPublish(options) → DesktopPublishReport`

Returns the signed manifest plus distribution metadata. The signed `update-manifest.json` is canonical JSON (sorted keys, no extraneous whitespace) so the Ed25519 signature is reproducible.

## `runDesktopReproCheck(options) → DesktopReproReport`

Returns a diff report whose `differences` array is empty on success. Non-empty differences fail the effect with a typed `ReproCheckError`.

## `runDesktopDoctor(options) → DesktopDoctorReport`

Returns a Schema-typed `DesktopDoctorReport`: `{ passed, ci, platform, arch, probes, layerGraph? }`. Each probe is a `DoctorDiagnostic` with `{ name, status: "ok" | "missing" | "warning", component, message, remediation?, installCommand?, docsUrl?, evidence }`. Probe names are exactly:

- `bun-version`
- `rust-toolchain`
- `platform-sdk`
- `webview-runtime`
- `signing-credentials`
- `build-tools`
- `package-manager-state`
- `native-capabilities`
- `native-host-cache`
- `config`

The `native-capabilities` probe decodes the parity matrix bundled with the CLI at `packages/cli/src/native-parity-matrix.json`, so doctor and the native parity reference report the same counts. Gate on `status === "missing"` for required prerequisites, and treat a `native-capabilities` warning as a host-route support gap.

`runDesktopDoctor` fails with `DoctorCapabilityTruthUnavailable` when the bundled parity matrix is missing or invalid — that is a build-system failure, not a probe result.

## `runReleaseWorkflow(config, services)`

Runs the resumable release workflow (`package` → `sign` → `notarize` when targeting macOS → `publish`) with telemetry and resume-on-failure. The workflow requires a `WorkflowEngine` layer; the CLI provides `WorkflowEngine.layerMemory` by default.

## Error types

Each command exports a closed error union:

- `PackagePipelineError` — `PackageCommandFailedError`, `PackageConfigError`, `PackageFileError`, `PackageMissingBuildArtifactError`, `PackageUnsupportedArtifactError`, `PackageUnsupportedHostError`, `PackageUnsupportedTargetError`.
- `SignPipelineError` — `SignCommandFailedError`, `SignConfigError`, `SignFileError`, `SignUnsupportedHostError`, `SignUnsupportedTargetError`.
- `NotarizePipelineError` — `NotarizeCommandFailedError`, `NotarizeConfigError`, `NotarizeFileError`, `NotarizeUnsupportedHostError`, `NotarizeUnsupportedTargetError`.
- `PublishPipelineError` — `PublishConfigError`, `PublishFileError`, `PublishSignatureError`.
- `BuildPipelineError` — `BuildConfigError`, `BuildUnsupportedHostError`, `BuildUnsupportedTargetError`, `BuildCommandFailedError`, `BuildFileError`.

## Format helpers

Each report has a matching formatter:

```ts
import { formatPackageReport, formatSignReport, formatDoctorReport } from "@orika/cli"

console.log(formatPackageReport(report))
```

## Related

- Tutorial: [Package, sign, and ship](../tutorials/04-package-and-sign.md)
- How-to: [Diagnose with doctor](../how-to/diagnose-with-doctor.md)
- Source: [`packages/cli/src/index.ts`](../../packages/cli/src/index.ts)
