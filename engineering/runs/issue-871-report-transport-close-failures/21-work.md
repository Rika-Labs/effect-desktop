## Changes

- Added `TransportCloseFailed` to the typed transport error union.
- Changed `TransportConnection.close` to return `Effect<void, TransportError, never>`.
- Mapped `makeConnection(...).close()` adapter exceptions to `TransportCloseFailed` with `<operation>.close`.
- Added a regression that a throwing adapter close produces a typed close failure instead of success.

## Verification

- `bun test packages/core/src/runtime/transport.test.ts`
- `bun run typecheck`
- `bunx prettier --check packages/core/src/runtime/transport.ts packages/core/src/runtime/transport.test.ts engineering/runs/issue-871-report-transport-close-failures/05-scout.md engineering/runs/issue-871-report-transport-close-failures/19-architect.md engineering/runs/issue-871-report-transport-close-failures/20-review.md issues.json`
- `bun run lint`
- `bun run check`
- `bun run lint:types`
- `bun test`
- `bun packages/cli/src/bin.ts check --api --write`
- `bun packages/cli/src/bin.ts check --api`
- `cargo fmt --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo check --workspace`
- `cargo test --workspace`

## Known Local Drift

- `bun run format:check` fails on pre-existing `.devin/config.local.json`; changed-file Prettier passed.

Handoff: `/pr`
