# Milestone 19: Devtools

Tracks `engineering/SPEC.md` §24.19 and GitHub issue #6. Format follows the
repo milestone convention and includes the §28.4 completion report.

## Goal

Provide a first-party runtime inspector for framework primitives that projects
canonical runtime state without becoming a second source of truth.

## Non-goals

Per §24.19:

- do not expand public API beyond the milestone;
- do not introduce product-specific concepts;
- do not skip tests because later milestones will add tests;
- do not solve cross-platform polish before the primitive is validated.

Specifically deferred from this phase: app-defined custom panel extension UX,
full native window chrome polish for the shell, production build enablement
beyond the explicit devtools gate, and CI performance budget enforcement.

## Required files

- `packages/devtools/src/shell.ts` and
  `packages/devtools/src/shell.test.ts` for the devtools shell lifecycle,
  loopback listener, per-launch token, production gate, and disable cleanup.
- `packages/devtools/src/live-panels.ts` and
  `packages/devtools/src/index.test.ts` for bridge, stream, resource,
  permission, and process panel projections.
- `packages/devtools/src/diagnostics-panels.ts` and
  `packages/core/src/runtime/telemetry.ts` for structured logs, traces, and
  metrics.
- `packages/devtools/src/performance-overlay.ts` for startup, bridge p99, and
  renderer frame budget projection.
- `packages/bridge/src/client.ts`, `packages/bridge/src/events.ts`,
  `packages/bridge/src/handshake.ts`, `packages/core/src/runtime/host-client.ts`,
  and related tests for trace identity propagation through IPC boundaries.
- Learning records for issues #18, #20, #22, #24, and #26.

## Public APIs

`@effect-desktop/devtools` exports:

- `DevtoolsShell`, `makeDevtoolsShell`, and `shouldStartDevtools` for the
  shell/listener lifecycle and production gate.
- `LiveRuntimePanels` / `LiveRuntimePanelsLive` / `makeLiveRuntimePanels` for
  bridge, stream, resource, permission, and process tables.
- `DiagnosticsPanels` / `DiagnosticsPanelsLive` / `makeDiagnosticsPanels` for
  logs, trace groups, and metric snapshots.
- `PerformanceOverlay` / `PerformanceOverlayLive` / `makePerformanceOverlay`
  for startup, bridge p99, and renderer frame budget rows.

`@effect-desktop/core` exports `Telemetry` and telemetry snapshot types used by
diagnostics and performance projections.

## Acceptance criteria

From §24.19:

- [x] panels display live data.
- [x] no secrets shown.
- [x] devtools works after runtime restart.

The runtime-restart criterion is covered by trace and bridge identity
propagation primitives from #26 plus the Phase 3 reconnect foundation; Phase 19
keeps devtools projections source-owned so reconnecting clients read the same
runtime snapshots rather than panel-local caches.

## Appendix C verification rows

```txt
Requirement: C.55 Secret redaction.
Test file: packages/bridge/src/redaction.test.ts,
packages/devtools/src/index.test.ts
Command: bun test
Result: pass locally before Phase 19 close and covered by CI in implementation
PRs #242 through #246.
Notes: Devtools live, diagnostics, and performance projections apply redaction
at the panel boundary and never own a separate unredacted display cache.
```

```txt
Requirement: C.70 Devtools redaction.
Test file: packages/devtools/src/index.test.ts,
packages/devtools/src/shell.test.ts
Command: bun test packages/devtools/src/index.test.ts
bun test packages/devtools/src/shell.test.ts
Result: pass locally before Phase 19 close and covered by CI in implementation
PRs #242 through #246.
Notes: Tests cover redacted runtime tables, diagnostics, performance rows,
loopback-only shell URL, 256-bit token creation, token rotation, and disable
cleanup.
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

Specialized Phase 19 evidence:

- `packages/devtools/src/shell.test.ts` covers production-disabled behavior
  unless both gates agree, 256-bit token creation, mode `0600` on POSIX, token
  rotation, explicit shell-window port failure, listener cleanup, and
  `DevtoolsShell.disable`.
- `packages/devtools/src/index.test.ts` covers command, worker/job, live runtime,
  diagnostics, and performance projections over owner-owned runtime state.
- `packages/core/src/runtime/telemetry.test.ts` covers bounded trace rings,
  disabled trace behavior, bounded metrics, logs, counters, histograms, and
  redaction.
- `packages/bridge/src/client.test.ts`, `packages/bridge/src/events.test.ts`,
  `packages/bridge/src/handshake.test.ts`, and
  `packages/core/src/runtime/host-client.test.ts` cover trace identity across
  bridge calls, event subscriptions, handshake methods, and host-client calls.
- CI validated implementation PRs #242, #243, #244, #245, and #246 on
  Blacksmith Ubuntu, Windows, and macOS runners before merge.

## Completion report

```txt
Milestone: Phase 19 - Devtools
Files changed: devtools shell lifecycle; live runtime panels; diagnostics
panels; performance overlay; telemetry runtime owner; trace identity propagation;
Phase 19 learning records.
Public APIs added: @effect-desktop/devtools DevtoolsShell, LiveRuntimePanels,
DiagnosticsPanels, PerformanceOverlay, CommandsDevtools, WorkersJobsDevtools;
@effect-desktop/core Telemetry and trace/metric/log snapshot types.
Tests added: shell lifecycle tests; live panel projection tests; diagnostics and
performance projection tests; telemetry tests; bridge and host trace identity
tests.
Validation commands run: bun install --frozen-lockfile; bun run check; bun run
typecheck; bun run lint; bun run lint:types; bun run format:check; bun test;
cargo fmt --check; cargo clippy --workspace --all-targets -- -D warnings; cargo
check --workspace; cargo test --workspace.
Validation results: all pass locally on the phase-close branch; Phase 19
implementation PRs #242 through #246 were green in Blacksmith CI before merge.
Known limitations: app-defined custom panels and a polished native devtools UI
remain future UX work; current milestone surfaces are Effect services and
projections over runtime owners.
Follow-up items: Phase 20 owns test harness completion; Phase 21 owns
performance budget enforcement; Phase 24 owns final release documentation and
API snapshot coverage.
```

## Completion notes

Phase 19 shipped as five implementation PRs plus this closure PR:

- #242 added the `DevtoolsShell` lifecycle with production gating, loopback-only
  listener, per-launch token, explicit shell-window port, and typed cleanup
  failures.
- #243 added `LiveRuntimePanels` as a redacted read-only projection over bridge
  calls, streams, resources, permissions, and processes.
- #244 added `Telemetry` ownership of logs, trace spans, and metric snapshots,
  plus `DiagnosticsPanels` as the read-only devtools projection.
- #245 added `PerformanceOverlay` over telemetry histograms for startup, bridge
  p99, and renderer frame budget rows.
- #246 wired trace identity through bridge, event, handshake, and host-client
  boundaries so devtools panels can correlate work by `traceId`.

The durable lesson from the phase is that debugging surfaces must report
owner-owned state. Devtools can reduce, redact, and display runtime facts, but it
must not invent the facts. The correct primitive is a narrow read model owned by
the service whose lifecycle is being observed, with devtools acting as a
privileged read-only projection.
