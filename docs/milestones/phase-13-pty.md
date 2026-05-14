# Milestone 13: PTY

Tracks `docs/SPEC.md` §24.13 and GitHub issue #121. Format follows the
repo milestone convention and includes the §28.4 completion report.

## Goal

Provide a cross-platform PTY primitive and core runtime `PTY` Effect service for
opening terminal children, writing input, resizing, streaming output, killing,
and cleaning up process trees.

## Non-goals

Per §24.13:

- do not expand public API beyond the milestone;
- do not introduce product-specific concepts;
- do not skip tests because later milestones will add tests;
- do not solve cross-platform polish before the primitive is validated.

Specifically deferred from this phase: terminal emulator/parser behavior,
capability prompt UI, devtools PTY panels, Worker/Job primitives, and final
release documentation/API snapshot coverage.

## Required files

- `crates/native-pty/src/lib.rs` for the Rust PTY primitive.
- `packages/core/src/runtime/pty.ts` and
  `packages/core/src/runtime/pty.test.ts` for the Effect service.
- `packages/core/src/index.ts` for the public core export.
- Learning records for issues #123, #125, #127, and #129.

## Public APIs

`@effect-desktop/core` exports:

- `PTY` / `PtyLayer` / `makePty` for typed PTY open operations. `makePty`
  requires an explicit platform adapter; there is no default unsupported
  adapter.
- `PtyApi`, `PtyHandle`, `PtyAdapter`, `PtyChild`, `PtyOptions`,
  `PtyPermissionPolicy`, `PtyBudgetPolicy`, and `PtyOutputPolicy` for runtime
  wiring and tests.
- `PtyOpenOptions`, `PtyResizeInput`, `PtyExitStatus`, and `PtySignalInput`
  structured values.

`crates/native-pty` exposes the Rust `open`, `write`, `resize`, `read`, `kill`,
`terminate_tree`, `force_kill_tree`, and `close_tree` primitive used by the
native host boundary.

## Acceptance criteria

From §24.13:

- [x] PTY opens.
- [x] write works.
- [x] resize works.
- [x] cleanup works.

## Appendix C verification rows

No Appendix C row is directly named for Phase 13. The process-tree cleanup and
output backpressure requirements are covered by the Phase 13 epic verification
text and by the Rust/core PTY tests.

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

Specialized Phase 13 evidence:

- `crates/native-pty/src/lib.rs` tests cover invalid command and size rejection,
  missing program mapping, PTY open/read/wait, stdin writes, resize, read input
  validation, stdin close state, drop cleanup, descendant process-tree
  termination, and force-kill behavior for children that ignore graceful
  termination.
- `packages/core/src/runtime/pty.test.ts` covers PTY open output and exit status,
  scoped resource registration, resource removal on exit and exit failure,
  validation before adapter activity, default-deny spawn policy, allow-listed
  commands, argv0 metacharacter rejection, unsupported default adapter failures,
  per-scope concurrent PTY budgets, output budget validation, chunk coalescing,
  quiet-window flush, `BackpressureOverflow`, `dropOldest` eviction, write,
  resize, kill, scope-close cleanup, budget release after close, and force-kill
  escalation.
- CI validated implementation PRs #210 through #213 on Blacksmith Ubuntu,
  Windows, and macOS runners before merge.

## Completion report

```txt
Milestone: Phase 13 - PTY
Files changed: native-pty Rust crate, core PTY Effect service, tests, public
export, and Phase 13 learning records.
Public APIs added: @effect-desktop/core PTY, PtyLayer, makePty,
PtyApi, PtyHandle, PtyAdapter, PtyChild, PtyOptions, PtyPermissionPolicy,
PtyBudgetPolicy, PtyOutputPolicy, PtyOpenOptions, PtyResizeInput,
PtyExitStatus, and PtySignalInput; crates/native-pty Rust PTY primitive.
Tests added: Rust native PTY primitive tests; core PTY runtime tests for
open/write/resize/output/kill, process-tree cleanup, permission policy, resource
budgets, and output backpressure/coalescing.
Validation commands run: bun install --frozen-lockfile; bun run check; bun run
typecheck; bun run lint; bun run lint:types; bun run format:check; bun test;
cargo fmt --check; cargo clippy --workspace --all-targets -- -D warnings; cargo
check --workspace; cargo test --workspace.
Validation results: all pass locally on the phase-close branch; Phase 13
implementation PRs #210 through #213 were green in Blacksmith CI before merge.
Known limitations: PTY runtime tests are skipped on Windows where the fake core
service path is not the native ConPTY integration path; full devtools and release
documentation remain later phases.
Follow-up items: Phase 16 integrates dynamic permission lifecycle, Phase 19 adds
devtools PTY visibility, and Phase 24 owns release documentation and API
snapshot coverage.
```

## Completion notes

Phase 13 shipped as four implementation PRs plus this closure PR:

- #210 added the `crates/native-pty` primitive over `portable-pty`, including
  validation, typed errors, stdin/stdout/read/write/resize/wait, and native tree
  termination hooks.
- #211 added the core `PTY` Effect service with `open`, output stream, stdin
  sink, resize, kill, scope-owned resources, permission policy, and budgets.
- #212 tightened PTY process-tree cleanup, including Windows job-object
  behavior and POSIX descendant termination verification.
- #213 added bounded PTY output streams with chunk coalescing, quiet-window
  flushing, drop-oldest overflow behavior, and backpressure failures.

The durable lesson from the phase is that terminal support is a resource
ownership problem before it is a rendering problem. The safe abstraction is a
typed PTY lifecycle that owns the child, the kill domain, output pressure, and
scope cleanup in one place.
