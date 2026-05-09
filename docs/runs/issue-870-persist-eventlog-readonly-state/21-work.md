## Changes

- Persisted `event_log_meta.read_only = 1` after append maps SQLite full pressure to `EventLogFull`.
- Kept the in-memory read-only latch as the fast path for the current process.
- Preserved the original `EventLogFull` if the best-effort metadata update also fails.
- Added a regression that injects one `SQLITE_FULL` event insert, verifies the metadata bit, reopens the log, and observes append fail from durable read-only state.

## Verification

- `bun test packages/core/src/runtime/event-log.test.ts`
- `bun run typecheck`
- `bun run lint`
- `bunx prettier --check packages/core/src/runtime/event-log.ts packages/core/src/runtime/event-log.test.ts issues.json docs/runs/issue-870-persist-eventlog-readonly-state/05-scout.md docs/runs/issue-870-persist-eventlog-readonly-state/19-architect.md docs/runs/issue-870-persist-eventlog-readonly-state/20-review.md docs/runs/issue-870-persist-eventlog-readonly-state/21-work.md`
- `bun run check`
- `bun run lint:types`
- `bun test`
- `cargo fmt --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo check --workspace`
- `cargo test --workspace`

## Known Local Drift

- `bun run format:check` fails on pre-existing `.devin/config.local.json`; changed-file Prettier passed.

Handoff: `/pr`
