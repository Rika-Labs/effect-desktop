# Milestone 23: Cross-platform hardening

Tracks `engineering/SPEC.md` §24.23 and GitHub issue #96. Format follows the
repo milestone convention and includes the §28.4 completion report.

## Goal

Run and fix the platform matrix so macOS, Windows, and Linux platform behavior is
explicit, typed, and release-gated instead of silently drifting by host OS.

## Non-goals

Per §24.23:

- do not expand public API beyond the milestone;
- do not introduce product-specific concepts;
- do not skip tests because later milestones will add tests;
- do not solve cross-platform polish before the primitive is validated.

Specifically deferred from this phase: adding new platform support cells,
promoting optional `windows-arm64` / `linux-arm64` cells to required status,
deep platform UX refinements beyond §11 / Appendix K, and Phase 24 release
criteria such as SBOM, CVSS, SLSA, signing, and secret scanning.

## Required files

- `crates/host/src/windows.rs`, `crates/host/src/window.rs`, and
  `packages/cli/src/package-pipeline.ts` for Windows high-DPI, dark mode,
  taskbar grouping identity, and MSI shortcut metadata.
- `crates/host/src/macos.rs`, `crates/host/src/window.rs`,
  `crates/host/src/methods/menu.rs`, and `crates/host-protocol/src/lib.rs` for
  macOS vibrancy, traffic-light offsets, Dock badge behavior, and menu routing.
- `crates/host/src/linux.rs`, `crates/host/src/methods/mod.rs`,
  `packages/native/src/global-shortcut.ts`, `packages/native/src/safe-storage.ts`,
  `packages/native/src/dock.ts`, and `packages/cli/src/package-pipeline.ts` for
  Linux Wayland fallback, capability probes, Secret Service availability, and
  Snap/Flatpak launcher hints.
- `engineering/verification-matrix.json`, `tests/spec/verification-matrix.test.ts`,
  `.github/workflows/ci.yml`, and `engineering/manual-gates/{macos,windows,linux}.md`
  for §20.10 required cells, Blacksmith CI cells, and manual gate tracking.
- Learning records for issues #102, #103, #104, and #105.

## Public APIs

No new top-level public service was introduced by the phase closeout. The phase
deepened existing platform behavior behind the already public §11 surfaces:

- `Window.create` carries macOS title-bar style, vibrancy, and traffic-light
  payloads through the bridge and host protocol.
- `Dock`, `Menu`, `GlobalShortcut`, and `SafeStorage` report platform capability
  and unsupported states as typed values matching Appendix K.
- `desktop package` records platform artifact metadata, including Linux
  launcher hints and Windows MSI shortcut identity.
- `engineering/verification-matrix.json` is the checked release-matrix data artifact
  consumed by CI and release documentation.

## Acceptance criteria

From §24.23:

- [x] examples pass on all platforms.
- [x] platform gaps documented.
- [x] doctor command works.

The examples and package checks run in the Blacksmith matrix cells declared in
`.github/workflows/ci.yml`. Platform gaps that cannot run headlessly are tracked
as manual gates under `engineering/manual-gates/`.

## Appendix C verification rows

```txt
Requirement: §20.10 Cross-platform verification matrix.
Test file: tests/spec/verification-matrix.test.ts
Command: bun test tests/spec/verification-matrix.test.ts
Result: pass locally before Phase 23 close and covered by CI in PR #369.
Notes: The test verifies required/optional cells, Appendix C row coverage,
Blacksmith runner labels, EFFECT_DESKTOP_MATRIX_CELL wiring, and manual-gate
files for hardware or logged-in-session rows.
```

```txt
Requirement: Appendix K platform behavior.
Test files: crates/host/src/windows.rs, crates/host/src/macos.rs,
crates/host/src/linux.rs, packages/native/src/index.test.ts,
packages/cli/src/index.test.ts
Command: bun test; cargo test --workspace
Result: pass locally before Phase 23 close and covered by CI in PRs #312, #338,
#353, and #369.
Notes: Tests cover Windows AppUserModelID and dark-mode handling, macOS window
polish payloads and menu validation, Linux Wayland/global-shortcut and
SafeStorage availability behavior, and packaging metadata.
```

## Validation commands

```bash
bun install --frozen-lockfile
bun run check
bun run typecheck
bun run lint
bun run lint:types
bun run format:check
bun test
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo check --workspace
cargo test --workspace
```

Specialized Phase 23 evidence:

- `crates/host/src/windows.rs` tests cover AppUserModelID validation, manifest
  fallback, high-DPI access-denied handling, and dark-mode value derivation.
- `crates/host/src/macos.rs`, `crates/host/src/methods/menu.rs`, and
  `crates/host-protocol/src/lib.rs` tests cover vibrancy material parsing,
  finite/non-negative traffic-light offsets, macOS window payload parity, Dock
  badge/menu routing, and menu root validation.
- `crates/host/src/linux.rs` and `packages/native/src/index.test.ts` tests cover
  Wayland session detection, target-scoped capability probes,
  `GlobalShortcut.isSupported`, `SafeStorage.isAvailable`, and Dock support
  values.
- `packages/cli/src/index.test.ts` tests cover Windows MSI shortcut metadata,
  Linux `.desktop`, AppStream, Snap, and Flatpak hint staging, and exact target
  artifact filtering.
- `tests/spec/verification-matrix.test.ts` covers §20.10 required cells,
  optional cells, CI cell exposure, manual-gate file presence, and current CI
  cell declaration.
- CI validated implementation PRs #312, #338, #353, and #369 on Blacksmith
  Ubuntu, Windows, and macOS runners before merge.

## Completion report

```txt
Milestone: Phase 23 - Cross-platform hardening
Files changed: Windows, macOS, and Linux host platform modules; native package
capability clients; package pipeline platform metadata; verification matrix;
manual gate files; Phase 23 learning records.
Public APIs added: no new top-level service; existing Window, Dock, Menu,
GlobalShortcut, SafeStorage, and package surfaces now carry platform-specific
behavior and typed capability values.
Tests added: host platform polish tests; native capability tests; package
metadata tests; verification matrix tests.
Validation commands run: bun install --frozen-lockfile; bun run check; bun run
typecheck; bun run lint; bun run lint:types; bun run format:check; bun test;
cargo fmt --check; cargo clippy --workspace --all-targets -- -D warnings; cargo
check --workspace; cargo test --workspace.
Validation results: all pass locally on the phase-close branch; Phase 23
implementation PRs #312, #338, #353, and #369 were green in Blacksmith CI before
merge.
Known limitations: `macos-x64` is a required manual-gate cell until a documented
Blacksmith macOS x64 runner is available; hardware/logged-in-session rows remain
pending release sign-off in `engineering/manual-gates/`.
Follow-up items: Phase 24 owns release-candidate API/docs/release gates; v1.1
can promote optional `windows-arm64` and `linux-arm64` cells to required status.
```

## Completion notes

Phase 23 shipped as four implementation PRs plus this closure PR:

- #312 added Windows polish hooks for DPI awareness, dark-mode title bars,
  AppUserModelID taskbar grouping, and MSI shortcut metadata, with optional
  polish failures modeled as observable non-launch-gating behavior.
- #338 added macOS window and menu polish, including vibrancy payloads,
  traffic-light offsets, Dock badge/menu routing, and host-side menu validation.
- #353 added Linux target-scoped capability probes, Wayland global-shortcut
  behavior, SafeStorage availability checks, Dock support values, and Linux
  package launcher hints.
- #369 added `engineering/verification-matrix.json`, matrix tests, Blacksmith CI cell
  names, and manual-gate files for cells that cannot run headlessly.

The durable lesson from the phase is that platform polish must be honest about
which platform owns each fact. Optional visual polish should not become a launch
gate, but capability guards and matrix cells must be precise because correct
callers use those values to decide behavior.
