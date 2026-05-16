# Issue #1267: Collapse SQLite onto Effect SqlClient

## Objective

Delete Effect Desktop's bespoke SQLite connection/statement API and make Effect
`SqlClient` the database interface. Effect should own SQL execution,
transactions, prepared statements, query interpolation, and driver errors.
Effect Desktop should keep only desktop-specific policy: filename validation,
`sqlite.open` authorization, owner-scope metadata, and resource visibility.

## Pre-change Shape

- `packages/core/src/runtime/sqlite.ts` exports both `SqlClientLive` and a
  separate `SQLite` service.
- The local `SQLite` service reimplements `connect`, `query`, `exec`,
  `prepare`, `transaction`, statement disposal, transaction locking, bind
  validation, and SQLite error-code mapping over `bun:sqlite`.
- Active package code already uses Effect SQL; the bespoke API is only exercised
  by its own tests and stale docs/API snapshots.
- The `todo-sqlite` template already uses `SqlClientLive`; it needs to provide
  the explicit `PermissionRegistry` policy required by the hardened layer.

## Target Shape

- Keep `SqlClient`, `SqlError`, `SqlModel`, and `SqliteClient` as the public SQL
  surface.
- Keep `SqlClientLive({ filename, ownerScope })` only as the desktop policy
  layer over `@effect/sql-sqlite-bun/SqliteClient.layer`.
- `SqlClientLive` validates filename and owner scope before driver acquisition.
- File-backed databases check `sqlite.open` through `PermissionRegistry` before
  the SQLite file can be created.
- The layer registers a scoped `sqlite` resource in `ResourceRegistry`; the
  entry is removed when the layer scope closes, and `ResourceRegistry.closeScope`
  closes the scoped SQL client.
- Settings' SQL-backed layer uses `SqlClientLive` so settings databases share
  the same permission and resource policy.
- Delete the bespoke `SQLite`, `SQLiteLive`, `makeSQLite`, connection,
  statement, transaction, bind, row, and local driver-error exports.

## Architecture Debt Sweep

Remove now:

- The local `SQLite.connect/query/exec/prepare/transaction` DSL.
- The local `SqliteConnection` and `SqlitePreparedStatement` wrappers.
- The local SQLite driver error taxonomy for operations now owned by Effect SQL.
- Implicit `SqlClientLive` use without a permission layer in the todo template.
- Settings' direct use of upstream `SqliteClient.layer`, which bypassed desktop
  permission/resource policy.

Keep:

- `SqlClientLive`, because it owns durable desktop semantics: path validation,
  permission checks, owner scope, and resource registration before delegating to
  Effect SQL.

Follow-up:

- None for the touched SQLite module. Settings still has its own high-level
  store API, but it owns schema/key migration policy rather than mirroring
  Effect SQL.

## Verification

- Focused:
  - `bun run typecheck --filter=@effect-desktop/core`
  - `bun test packages/core/src/runtime/sqlite.test.ts packages/core/src/index.test.ts tests/repo-shape.test.ts`
  - `rg -n "makeSQLite|SQLiteLive|yield\\* SQLite|SqliteConnection|SqlitePreparedStatement|SqliteParams|SqliteRow|SqliteValue" packages apps templates tests docs api/snapshots`
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

- Replacing Settings with `KeyValueStore.layerSql` policy work beyond existing
  behavior.
- Designing a new ORM.
- Changing renderer SQLite WASM or PGlite layers.
