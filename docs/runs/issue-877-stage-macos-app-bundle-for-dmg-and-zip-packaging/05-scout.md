## Domain

MacOS `desktop package` artifact planning, specifically the `.app` bundle dependency required by `.dmg` and `.zip` outputs.

## Evidence gathered

- `packages/cli/src/package-pipeline.ts` - `runDesktopPackage` removes `dist/desktop/<platform>`, then produces only the requested artifact kinds.
- `packages/cli/src/package-pipeline.ts` - `dmg` and `zip` producers pass `macosAppBundlePath(plan)` to `hdiutil` and `ditto` without staging the app bundle in those branches.
- `packages/cli/src/index.test.ts` - the macOS package test covers default `app,dmg,zip` ordering, but not explicit `--artifact dmg` or `--artifact zip`.
- `docs/learnings/2026-05-06-bun-desktop-package-artifacts.md` - packaging correctness requires validating the exact artifact and identity metadata downstream stages consume.

## Prior art in this repo

The package pipeline already has the right boundary: a single Effect-owned module validates the build layout, runs platform packagers through an injectable command runner, and validates outputs before metadata. Linux secondary staging is local to the artifact producer (`stageLinuxAppDir`, `stageDebRoot`, `stageRpmRoot`). macOS has `produceMacosApp`, but `.dmg` and `.zip` currently treat its output as an external prerequisite.

## First-principles decomposition

- Primitive facts: `.dmg` and `.zip` are wrappers around a `.app` directory; the package run deletes the output directory before producing artifacts.
- Invariants: platform tools must receive an app bundle produced from the current validated build layout; metadata must describe artifacts from the current package run.
- Constraints: no cross-platform package scope; keep existing artifact names and output directories; use the injectable command runner for external tools.
- Failure modes: clean `--artifact dmg` or `--artifact zip` invokes a platform tool with a nonexistent `.app` path; fake runners can mask this by writing only the requested output.
- Source of truth: `build/effect-desktop/<target>/app-manifest.json` plus `PackagePlan`.

## Game board

- Players: package authors, release tooling, CI, reviewers, future maintainers.
- Incentives: authors prefer one artifact at a time; release tooling assumes artifacts are self-contained and current.
- Information asymmetries: `--artifact dmg` looks independent at the CLI, but it depends on a staged app bundle.
- Bad local move: leave the dependency implicit and rely on default all-artifact ordering.
- Global cost: clean packaging can ship or sign artifacts whose prerequisite was missing, stale, or unverified.
- Desired equilibrium: every secondary macOS artifact stages or reuses the required `.app` within the same package run.

## Library / API / pattern landscape

No external API uncertainty. The relevant pattern is local: keep filesystem staging inside `package-pipeline.ts`, use typed `PackageFileError` for filesystem failure, and keep platform tool calls behind `PackageCommandRunner`.

## Constraints and edge cases discovered

- Default macOS artifact ordering already stages `app` before `dmg` and `zip`; the fix must not duplicate the app step there.
- Explicit `--artifact dmg` and `--artifact zip` must include a `macos-app` step before the tool step.
- The app bundle path must come from the actual app artifact plan, not a separately constructed string.
- Tests must make absence of a preexisting `.app` observable.

## Open questions for /interview

1. No product question remains; the issue body already fixes the intended behavior and non-goals.
