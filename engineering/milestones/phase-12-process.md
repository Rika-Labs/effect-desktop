# Milestone 12: Process

Tracks `engineering/SPEC.md` §24.12 and GitHub issue #106. Format follows the
repo milestone convention and includes the §28.4 completion report.

## Goal

Provide the core runtime `Process` service for spawning child processes with
typed stdin/stdout/stderr streams, exit status handling, process-tree cleanup,
argv permission policy, and resource budgets.

## Non-goals

Per §24.12:

- do not expand public API beyond the milestone;
- do not introduce product-specific concepts;
- do not skip tests because later milestones will add tests;
- do not solve cross-platform polish before the primitive is validated.

Specifically deferred from this phase: PTY support, Worker service semantics,
capability prompt UI, devtools process panels, and release-readiness API
snapshot documentation.

## Required files

- `packages/core/src/runtime/process.ts` and
  `packages/core/src/runtime/process.test.ts`.
- `packages/core/src/index.ts` for the public core export.
- Learning records for issues #107, #109, #111, and #113.

## Public APIs

`@effect-desktop/core` exports:

- `Process` / `ProcessLive` / `ProcessLayer` / `makeProcess` for typed process
  spawn operations.
- `ProcessApi`, `ProcessHandle`, `ProcessAdapter`, `ProcessChild`,
  `ProcessOptions`, `ProcessPermissionPolicy`, and `ProcessBudgetPolicy` for
  runtime wiring and tests.
- `ProcessExitStatus` and `ProcessSignalInput` structured values.

## Acceptance criteria

From §24.12:

- [x] spawn works.
- [x] streams work.
- [x] scope cleanup kills process.

## Appendix C verification rows

No Appendix C row is directly named for Phase 12. The security-relevant argv and
budget checks are covered by the Phase 12 epic verification text and by
`packages/core/src/runtime/process.test.ts`.

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

Specialized Phase 12 evidence:

- `packages/core/src/runtime/process.test.ts` covers spawn stdout and exit
  status, scoped resource registration, automatic resource removal on exit,
  validation before adapter activity, default-deny spawn policy, allow-listed
  commands, argv0 metacharacter rejection, shell permission gating, per-scope
  concurrent process budgets, budget release after exit, stdout/stderr
  `BackpressureOverflow`, missing executable mapping, stdin sink writes, typed
  kill, scope-close tree termination, grace-window force kill, Bun subprocess
  integration, and descendant process-group cleanup on POSIX.
- CI validated implementation PRs #206 through #209 on Blacksmith Ubuntu,
  Windows, and macOS runners before merge.

## Completion report

```txt
Milestone: Phase 12 - Process
Files changed: core Process service, adapter, tests, public export, and Phase 12
learning records.
Public APIs added: @effect-desktop/core Process, ProcessLive, ProcessLayer,
makeProcess, ProcessApi, ProcessHandle, ProcessAdapter, ProcessChild,
ProcessOptions, ProcessPermissionPolicy, ProcessBudgetPolicy, ProcessExitStatus,
and ProcessSignalInput.
Tests added: Process runtime tests for spawn/streams/exit/kill, scoped resource
lifecycle, process-tree cleanup, argv permissions, shell gating, and output /
concurrency budgets.
Validation commands run: bun install --frozen-lockfile; bun run check; bun run
typecheck; bun run lint; bun run lint:types; bun run format:check; bun test;
cargo fmt --check; cargo clippy --workspace --all-targets -- -D warnings; cargo
check --workspace; cargo test --workspace.
Validation results: all pass locally on the phase-close branch; Phase 12
implementation PRs #206 through #209 were green in Blacksmith CI before merge.
Known limitations: dynamic capability lifecycle and approval prompts remain
Phase 16 work; PTY behavior remains Phase 13; devtools process visualization
remains Phase 19; final release API snapshots remain Phase 24.
Follow-up items: Phase 13 builds the PTY resource on the same cleanup and budget
lessons, Phase 16 replaces static process permission policy with dynamic
registry checks, and Phase 18 introduces Worker/Job lifecycle primitives.
```

## Completion notes

Phase 12 shipped as four implementation PRs plus this closure PR:

- #206 added the typed `Process` service surface with `spawn`, stdin/stdout/stderr
  streams, exit status, kill, schema validation, adapter substitution, and typed
  `HostProtocolError` mapping.
- #207 added process-tree cleanup on scope close with graceful termination and
  force-kill escalation.
- #208 added permission-gated argv allow-list behavior, including default-deny
  spawn policy, shell gating, and metacharacter rejection.
- #209 added per-scope concurrent process budgets and bounded stdout/stderr
  streams that fail with `BackpressureOverflow`.

The durable lesson from the phase is that process execution is lifecycle plus
authority, not just `spawn`. A safe process service must validate argv, check
authority, reserve budget, register cleanup, expose streams, and release
resources as one ordered Effect program.
