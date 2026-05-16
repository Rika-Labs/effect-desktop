# Milestone 2: Runtime supervision

Tracks `engineering/SPEC.md` §24.2 and GitHub issue #28. Format follows the repo milestone convention and includes the §28.4 completion report.

## Goal

Make the Rust host launch and supervise the Bun runtime process before showing the native window.

## Non-goals

Per §24.2:

- do not expand public API beyond the milestone;
- do not introduce product-specific concepts;
- do not skip tests because later milestones will add tests;
- do not solve cross-platform polish before the primitive is validated.

Specifically deferred from this phase: length-prefixed host protocol framing, host method dispatch, version negotiation beyond the ready event's version field, renderer reconnect, heartbeats, resource handles, and the long-lived Effect service graph.

## Required files

- `packages/core/src/runtime/main.ts` and `packages/core/src/runtime/main.test.ts`.
- `crates/host/src/runtime/mod.rs` and `crates/host/src/runtime/platform.rs`.
- `crates/host/src/main.rs`.
- `crates/host/tests/startup_smoke.rs`.
- Learning records for issues #29, #30, #31, and #33.

## Public APIs

None added. The runtime entry is an internal process executable, and the Rust supervisor surface remains crate-private until later phases define public host/runtime contracts.

## Acceptance criteria

From §24.2:

- [x] runtime ready received from a canonical Bun entry point;
- [x] runtime crash is detected after readiness;
- [x] host does not crash when the runtime exits or crashes.

## Appendix C verification rows

No Appendix C row is directly gated by Phase 2. This phase establishes the supervised process substrate; protocol, error-envelope, reconnect, stream, and permission verification rows begin in Phase 3 and later.

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

Specialized runtime-supervision evidence:

- `packages/core/src/runtime/main.test.ts` executes the Bun runtime entry and asserts exactly one `runtime.ready` JSON line.
- `crates/host` runtime tests spawn Bun stubs and assert process start, stdio capture, terminal event ordering, pre-ready failure behavior, post-ready dev restart, prod no-restart, and failed-but-live cleanup.
- `crates/host/tests/startup_smoke.rs` proves the host binary emits its startup event and exits zero on the finite smoke path after runtime readiness.
- CI validated the final Phase 2 head on macOS, Ubuntu, and Windows in PR #153.

## Completion report

```txt
Milestone: Phase 2 - Runtime supervision
Files changed: packages/core runtime entry and test; crates/host runtime supervisor, platform cleanup, startup wiring, and smoke tests; Phase 2 learning records.
Public APIs added: None.
Tests added: Bun runtime subprocess contract test; runtime supervisor unit/integration tests; host startup smoke coverage for readiness-gated startup.
Validation commands run: bun install --frozen-lockfile; bun run check; bun run typecheck; bun run lint; bun run lint:types; bun run format:check; bun test; cargo fmt --check; cargo clippy --workspace --all-targets -- -D warnings; cargo check --workspace; cargo test --workspace.
Validation results: all pass locally on the milestone-close branch; Phase 2 implementation PRs #150 through #153 were green in CI before merge.
Known limitations: runtime exits after ready until Phase 3 keeps it alive for protocol work; no framed transport, host methods, heartbeat, renderer reconnect, resource registry, or public bridge contract exists yet.
Follow-up items: Phase 3 adds host-protocol envelopes, framed stdio transport, handshake/version methods, initial window methods, error-envelope parity, and renderer reconnect.
```

## Completion notes

Phase 2 shipped as four small PRs:

- #150 added the canonical Bun runtime entry and tested the stdout ready-event contract at the subprocess boundary.
- #151 added the host runtime supervisor, typed lifecycle events, stdout/stderr capture, and platform process-tree cleanup for POSIX and Windows.
- #152 made window startup depend on `runtime.ready` and kept the post-ready event stream owned by the supervisor.
- #153 added explicit dev/prod runtime profile selection, bounded dev restarts after post-ready crashes, production crash logging without silent restart, and cleanup for failed-but-live generations.

The durable lesson from the phase is that runtime supervision is a lifecycle ownership problem, not a logging problem. Terminal events, readiness transitions, stdio failures, restart timeouts, and process-tree cleanup all have to be owned by one supervisor state machine or the host can leak diagnostics, orphan children, or hang while trying to recover.
