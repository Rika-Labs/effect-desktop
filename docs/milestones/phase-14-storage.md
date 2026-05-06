# Milestone 14: Storage

Tracks `docs/SPEC.md` §24.14 and GitHub issue #135. Format follows the
repo milestone convention and includes the §28.4 completion report.

## Goal

Provide the core runtime storage primitives: `SQLite`, `Settings`, `EventLog`,
`Transport`, and `WindowState`, with typed Effect APIs, recovery semantics,
scope ownership, and replayable state where applicable.

## Non-goals

Per §24.14:

- do not expand public API beyond the milestone;
- do not introduce product-specific concepts;
- do not skip tests because later milestones will add tests;
- do not solve cross-platform polish before the primitive is validated.

Specifically deferred from this phase: Secrets over SafeStorage, dynamic
PermissionRegistry integration, storage devtools panels, final release docs, and
the Phase 20 reusable testing harness.

## Required files

- `packages/core/src/runtime/sqlite.ts` and
  `packages/core/src/runtime/sqlite.test.ts`.
- `packages/core/src/runtime/settings.ts` and
  `packages/core/src/runtime/settings.test.ts`.
- `packages/core/src/runtime/event-log.ts` and
  `packages/core/src/runtime/event-log.test.ts`.
- `packages/core/src/runtime/transport.ts` and
  `packages/core/src/runtime/transport.test.ts`.
- `packages/core/src/runtime/window-state.ts` and
  `packages/core/src/runtime/window-state.test.ts`.
- `packages/core/src/index.ts` for the public core exports.
- Learning records for issues #136, #137, #138, #140, and #142.

## Public APIs

`@effect-desktop/core` exports:

- `SQLite` / `SQLiteLive` / `makeSQLite` and related connection, statement, and
  error types.
- `Settings` / `SettingsLive` / `makeSettings` and `SettingsStore` for
  schema-validated key/value persistence.
- `EventLog` / `makeEventLog` and `EventLogStore` for append/query/subscribe
  audit and replay streams.
- `Transport` / `TransportLive` / `makeTransport`, framing helpers, and
  in-memory transport pair helpers.
- `WindowState` / `makeWindowState` and structured window-state records/events.

## Acceptance criteria

From §24.14:

- [x] migrations run.
- [x] settings persist.
- [x] events replay.

Additional epic acceptance evidence:

- [x] `SQLite.transaction` rolls back failed Effect programs.
- [x] `Settings.update` serializes concurrent calls.
- [x] corrupt Settings storage can recover from a backup.
- [x] `EventLog.query({ from })` returns events in monotonic order.
- [x] `Transport.frame` / `unframe` round-trip length-prefixed and JSON-RPC
      frames.
- [x] `WindowState.restore(windowId)` returns prior state and snaps off-screen
      rectangles to the primary display.

## Appendix C verification rows

No Appendix C row is directly named for Phase 14. Storage durability,
recovery, replay, framing, and window restore behavior are covered by the Phase
14 epic verification text and by the service-specific tests.

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

Specialized Phase 14 evidence:

- `packages/core/src/runtime/sqlite.test.ts` covers in-memory connections,
  invalid inputs before open, exec change counts, commit/rollback transaction
  behavior, prepared statements, transaction serialization, scope-close cleanup,
  and constraint error mapping.
- `packages/core/src/runtime/settings.test.ts` covers schema-validated get/set,
  defaults, key listing, delete change events, invalid value rejection,
  serialized update, change streams, transactional migrations, missing migration
  failures, and corrupt database recovery from backup.
- `packages/core/src/runtime/event-log.test.ts` covers monotonic append/query,
  cursor/type filtering, explicit null replay, concurrent append id allocation,
  persistence across reopen, replay-then-live subscribe, retention, invalid
  append validation, and read-only `EventLogFull` behavior.
- `packages/core/src/runtime/transport.test.ts` covers length-prefixed framing,
  JSON-RPC `Content-Length` framing, split stream unframing, invalid frame
  failures, in-memory transport pairs, and closed-connection failures.
- `packages/core/src/runtime/window-state.test.ts` covers persist/restore,
  missing state, corrupt-file rename, read failures, injected bounds validation,
  independent multi-window restore, off-screen snapping, clear, and observe
  events.
- CI validated implementation PRs #214 through #218 on Blacksmith Ubuntu,
  Windows, and macOS runners before merge.

## Completion report

```txt
Milestone: Phase 14 - Storage
Files changed: core SQLite, Settings, EventLog, Transport, and WindowState
services; tests; public exports; and Phase 14 learning records.
Public APIs added: @effect-desktop/core SQLite, Settings, EventLog, Transport,
WindowState services and their store/connection/framing/state helper types.
Tests added: storage runtime tests for SQLite transactions and scope cleanup,
Settings migrations/recovery/change streams, EventLog retention/replay/live
tail, Transport framing/in-memory pairs, and WindowState restore/recovery.
Validation commands run: bun install --frozen-lockfile; bun run check; bun run
typecheck; bun run lint; bun run lint:types; bun run format:check; bun test;
cargo fmt --check; cargo clippy --workspace --all-targets -- -D warnings; cargo
check --workspace; cargo test --workspace.
Validation results: all pass locally on the phase-close branch; Phase 14
implementation PRs #214 through #218 were green in Blacksmith CI before merge.
Known limitations: Secrets, dynamic permissions, storage devtools, release docs,
and reusable test harnesses remain later phases; `EventLog` uses SQLite-backed
retention rather than segmented log files at this stage.
Follow-up items: Phase 15 adds Secrets and redaction, Phase 16 adds dynamic
permission lifecycle, Phase 19 adds devtools storage visibility, and Phase 24
owns release documentation and API snapshot coverage.
```

## Completion notes

Phase 14 shipped as five implementation PRs plus this closure PR:

- #214 added the `SQLite` Effect service over `bun:sqlite`, including scoped
  connections, prepared statements, transactions, and typed SQLite errors.
- #215 added the typed `Settings` store on top of SQLite with schema validation,
  migrations, serialized update, change streams, delete/keys helpers, and backup
  recovery.
- #216 added the SQLite-backed `EventLog` append/query/subscribe store with
  monotonic ids, retention, live tail, and read-only behavior after full-disk
  failures.
- #217 added the `Transport` runtime service and reusable framing helpers for
  length-prefixed and JSON-RPC-style frames.
- #218 deepened `WindowState` persistence with multi-window restore, display
  bounds validation, off-screen snapping, corrupt-file recovery, clear, and
  observe events.

The durable lesson from the phase is that storage is five related persistence
problems, not one generic store. Each primitive owns a different invariant:
transaction scope, schema migration, append order, frame boundaries, or
window-restore sanity. Keeping those invariants in separate deep modules makes
the correct storage path easier than hand-rolled JSON files.
