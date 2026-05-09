# ADR-0003: Adopt @effect/sql-sqlite-bun and delete bespoke SQLite service (T02)

## Status

Accepted

## Context

`packages/core/src/runtime/sqlite.ts` reimplements the `SqlClient` API directly on top of `bun:sqlite`. It exposes raw SQL strings, hand-mapped `Record<string, SqliteValue>` rows, no typed repositories, and no migration story. Internal storage call-sites (event log, audit, settings) each re-derive low-level primitives.

Effect v4 ships `effect/unstable/sql` with `SqlClient`, `Model.Class`, `Model.makeRepository`, and `Model.makeDataLoaders`. The concrete driver for Bun is `@effect/sql-sqlite-bun`, exposing `SqliteClient.layer({ filename })`. The same `Model.Class` definition works across runtime SQLite (this ADR), renderer WASM SQLite ([ADR-0015](adr-0015-sql-sqlite-wasm-renderer.md)), and IndexedDB ([ADR-0016](adr-0016-platform-browser-indexeddb.md)).

Carrying the bespoke surface means each internal storage call-site owns row decoding, and schema changes require grepping SQL strings rather than updating a typed class.

## Decision

Delete the bespoke SQLite implementation. Adopt `effect/unstable/sql` as the storage backbone with `@effect/sql-sqlite-bun` as the concrete driver.

- `runtime/sqlite.ts` becomes a thin re-export of `SqlClient`, `Model`, and `SqliteClient.layer` from `@effect-desktop/core`.
- Internal storage (event log, audit, settings) migrates to `Model.Class` definitions with `Model.makeRepository` for typed CRUD and `Model.makeDataLoaders` for batched lookups.
- The `SqlClient` connection is registered in `ResourceRegistry` so the open handle participates in scope-tracked disposal alongside other runtime resources.
- Migrations are declared via `Model` migrations adjacent to the schema, not via ad-hoc SQL strings.
- The driver layer is `SqliteClient.layer({ filename })` resolved from `FileSystem` and `Path` provided by T03.

Cross-links: [ADR-0004](adr-0004-platform-bun.md) (driver depends on platform-bun), [ADR-0005](adr-0005-keyvaluestore-settings.md) (Settings layer sits on SqlClient), [ADR-0008](adr-0008-eventlog.md) (EventLog runtime persistence), [ADR-0015](adr-0015-sql-sqlite-wasm-renderer.md) (same Model.Class shared to renderer).

## Alternatives considered

**Keep bespoke**: works today but every new internal table grows another hand-mapped decoder. Migration story is undefined. Rejected.

**Use a third-party ORM** (Drizzle, Prisma): breaks Effect-first composability; no `Model.Class` sharing with renderer. Rejected.

**Wait for stable**: `@effect/sql-sqlite-bun` is already used in production Effect apps. Waiting blocks the renderer WASM story which depends on shared `Model.Class`. Rejected.

## Consequences

**Positive**

- `Model.Class` is defined once and shared to renderer WASM SQLite and IndexedDB without duplication.
- `Model.makeRepository` gives typed CRUD and batched lookups; raw SQL strings disappear from internal code.
- Connection disposal participates in standard runtime scope lifecycle.

**Negative**

- `effect/unstable/sql` API is beta; column-type or migration API may shift before stable.
- All existing internal storage call-sites require a migration rewrite.

**Neutral**

- Migration cost is bounded to the bridge package's internal consumers (event log, audit, settings). Application storage schemas are authored by users and unaffected.

## Validation

A `Model.Class` for the event log round-trips a row through `Model.makeRepository` against the runtime SQLite database; disposal closes the handle when the runtime scope closes. `bun run typecheck` and `bun test` pass with no reference to the deleted bespoke surface.

## Migration notes

1. Delete `packages/core/src/runtime/sqlite.ts`.
2. Add `@effect/sql-sqlite-bun` to `packages/core`.
3. Add re-exports of `SqlClient`, `Model`, `SqliteClient` from `@effect-desktop/core`.
4. Rewrite event log, audit, and settings storage as `Model.Class` + `Model.makeRepository`.
5. Register the `SqlClient` layer in `ResourceRegistry` for scope-tracked disposal.
