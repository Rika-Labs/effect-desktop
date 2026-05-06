# Doctor Probes Aggregate Values

## Observation

The doctor command stayed simple when each environment check returned a probe result instead of throwing or short-circuiting on the first missing tool. That let the CLI show every missing component in one report while keeping optional signing and cache checks as warnings.

## Evidence

- Issue #66 required `desktop doctor` to report typed `DoctorMissing` values, support `--json`, and avoid interactive prompts in CI mode.
- PR #256 added `packages/cli/src/doctor.ts` with an injectable `DoctorCommandRunner`, typed probe results, text and JSON formatting, and CLI wiring for `doctor [--config <path>] [--ci] [--json]`.
- Tests cover a missing Rust toolchain, a passing run with optional signing/cache warnings, and package-manager misconfiguration.
- The real command `bun packages/cli/src/bin.ts doctor --config apps/playground/desktop.config.ts` passed locally on macOS while reporting signing credentials as a warning.
- Local and CI validation passed on the Blacksmith macOS, Linux, and Windows matrix.

## General principle

An environment validator should aggregate probe values before deciding the exit code. A single missing tool is not the only useful fact; the user needs the complete failure surface and exact remediations before they change the machine.

## Trigger condition

Apply this when a command validates external host state, toolchains, credentials, package-manager state, or platform SDKs.

## Limits / counterexamples

Do not aggregate after a probe mutates host state or depends on a previous probe's side effect. Those probes should be modeled as explicit ordered steps with their own lifecycle state.

## Codification target

- docs/learnings

## Proposed amendment or issue

No AGENTS.md change. Keep future doctor probes as value-returning checks with explicit `ok`, `missing`, or `warning` status, and make the final exit decision only after all required probes run.
