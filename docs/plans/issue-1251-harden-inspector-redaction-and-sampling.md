# Issue #1251: Harden Inspector redaction and sampling

## Objective

Make Inspector capture safe by default. Runtime and devtools data must pass a
single safety policy before it reaches storage, panel snapshots, exported
fixtures, or future Inspector transport/UI surfaces. The policy must redact
secret-shaped data, omit high-risk payload classes, cap payload size, support
deterministic sampling, gate production capture, and expose typed evidence when
data is redacted, truncated, sampled out, or disabled.

## Pre-change Shape

- `Telemetry` redacts structured log fields when writing logs, but traces,
  metrics, and panel snapshots rely on scattered redaction at read time.
- `LiveRuntimePanels`, `DiagnosticsPanels`, `PerformanceOverlay`, and
  `WorkersDevtools` each call `redact(...)` directly.
- `LogsPanel` stores `String(opts.message)` in its own buffer without a shared
  Inspector safety boundary.
- `DevtoolsSnapshotClient` composes panel snapshots and does not apply a final
  safety pass.
- Production devtools startup is gated by flags, but capture safety policy is
  not part of the start input.

## Target Shape

- Add a canonical `InspectorSafetyPolicy` service in `@effect-desktop/core`.
- Extend the shared redaction primitive with evidence-producing helpers so
  bridge, telemetry, and devtools share one redaction matcher instead of
  duplicating secret heuristics.
- Policy application returns either a kept payload plus evidence, or a dropped
  payload plus evidence. Evidence never contains raw values.
- Policy owns:
  - redaction evidence;
  - high-risk key omission for payload/body/stdin/stdout/stderr/env/file content
    and user input shaped fields;
  - encoded payload byte budgets;
  - string byte budgets;
  - deterministic sampling with injectable decision source;
  - production capture validation.
- Devtools panels depend on `InspectorSafetyPolicy` and attach safety evidence
  to snapshots. They should not call `redact(...)` directly.
- `LogsPanel` captures messages through the safety policy, so raw logger text is
  not a bypass.
- `DevtoolsSnapshotClient` applies a final policy pass to the composed export as
  a defense-in-depth boundary.

## Architecture Debt Sweep

Remove now:

- Scattered panel-local `redact(...)` calls in devtools projections.
- `LogsPanel`'s raw string capture path.
- Snapshot export with no final safety pass.

Keep:

- `RedactionFilter`, because it owns durable desktop semantics: shared
  secret-pattern matching, Effect `Redacted` support, and JSON materialization.
- Panel row cap and frame interval helpers for now; they validate devtools UI
  controls and are not wrappers over Effect observability primitives.

Follow-up:

- None expected for Inspector safety. If a later panel introduces another
  display-side cache, it must either use `InspectorSafetyPolicy` at write time or
  be rejected in review.

## Verification

- Focused:
  - `bun test packages/bridge/src/redaction.test.ts`
  - `bun test packages/core/src/runtime/telemetry.test.ts`
  - `bun test packages/devtools/src/index.test.ts packages/devtools/src/panels.test.ts packages/devtools/src/shell.test.ts`
  - `bun test packages/test/src/index.test.ts`
  - `rg -n "redact\\(" packages/devtools/src`
- API:
  - `bun packages/cli/src/bin.ts check --api --write`
- Full before push:
  - `bun run format:check`
  - `git diff --check`
  - `bun run typecheck`
  - `bun run lint`
  - `bun run lint:types`
  - `bun run check`
  - `bun test`
  - `bun run build`
  - `bun packages/cli/src/bin.ts check --api`
  - `cargo fmt --check`
  - `cargo check --workspace`
  - `cargo test --workspace`
  - `cargo clippy --workspace --all-targets -- -D warnings`

## Out of Scope

- Showing raw secrets in privileged debug mode.
- Cloud telemetry upload.
- Perfect classification of arbitrary user-authored prose.
- Building the standalone or embedded Inspector UI.
