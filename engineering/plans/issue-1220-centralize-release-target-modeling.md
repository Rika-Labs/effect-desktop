# Issue #1220: Centralize Release Target Modeling

## Objective

Make build, package, signing, notarization, and publishing consume one canonical release target model instead of each pipeline defining its own target strings, platform parsing, host detection, binary naming, and artifact policy.

## Current Shape

- `packages/cli/src/index.ts` owns `BuildTarget`, `detectHostTarget`, `resolveBuildTarget`, `readBuildTargets`, and host binary naming.
- `packages/cli/src/package-pipeline.ts` owns parallel `PackageTarget`, host detection, platform parsing, artifact selection, and architecture naming.
- `packages/cli/src/signing-pipeline.ts` owns parallel `SignTarget`, host detection, platform parsing, and artifact metadata decoding.
- `packages/cli/src/notarization-pipeline.ts` owns a macOS-only target subset and its own host detection.
- `packages/cli/src/update-manifest.ts` owns `PublishTarget`, publish filtering, and platform directory parsing.

These shapes describe the same release contract, so each local helper is a drift point.

## Target Shape

- Add `packages/cli/src/targets.ts` as the single source of truth for release target data.
- Model target data with Effect `Schema`:
  - `DesktopOs`
  - `DesktopArch`
  - `DesktopTargetId`
  - `DesktopTarget`
  - `DesktopArtifactKind`
- Export pure policy helpers from the same module:
  - `desktopTargetId`
  - `parseDesktopTargetId`
  - `decodeDesktopTargetId`
  - `detectDesktopHostTarget`
  - `requireDesktopHostTarget`
  - `resolveDesktopTarget`
  - `desktopPlatformDirectory`
  - `hostBinaryName`
  - `hostBuildOutputPath`
  - `artifactKindsForTarget`
  - architecture renderers for Wix, AppImage, Debian, and RPM.
- Keep pipeline-specific error classes, but construct them from canonical decode/resolve failures.
- Keep public report fields as target IDs for now because package metadata, update manifests, and tests serialize target strings.

## Migration Order

1. Introduce `targets.ts` with focused tests that cover every supported target, host aliases, platform directories, host binary names, artifact sets, and architecture renderers.
2. Migrate build target detection, `build.targets` decoding, host binary naming, and host output paths in `packages/cli/src/index.ts`.
3. Migrate package target resolution, artifact selection, platform parsing, and architecture renderers in `package-pipeline.ts`.
4. Migrate sign, notarize, and publish metadata decoding to the canonical target and artifact helpers.
5. Export the canonical target types/helpers from the CLI public surface and update API snapshots if required.

## Architecture Debt Sweep

Remove now:

- Duplicate target unions and `is*Target` predicates across build/package/sign/notarize/publish.
- Duplicate host-detection helpers across release pipelines.
- Duplicate `startsWith("macos-")` platform parsing and target-specific architecture renderers.

Keep as follow-ups only if discovered larger than this issue:

- Raw `process.platform`/`process.arch` reads in unrelated doctor/release checks.
- Broader CLI file-system and command execution adapters, which are tracked by later Effect platform issues.

## Verification

- Focused:
  - `bun test packages/cli/src/targets.test.ts packages/cli/src/index.test.ts`
- Full before push:
  - `bun run format:check`
  - `git diff --check`
  - `bun run typecheck`
  - `bun run lint`
  - `bun run lint:types`
  - `bun run check`
  - `bun test`
  - `bun run build`
  - `bun run desktop check --api`
  - `cargo fmt --check`
  - `cargo check --workspace`
  - `cargo test --workspace`
  - `cargo clippy --workspace --all-targets -- -D warnings`

## Out of Scope

- Adding new targets or artifact formats.
- Enabling cross-platform build, package, sign, or notarize.
- Reworking release workflows tracked by #1203.
