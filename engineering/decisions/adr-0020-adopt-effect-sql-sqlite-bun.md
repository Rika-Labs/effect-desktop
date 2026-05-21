# ADR-0001: Adopt @effect/sql-sqlite-bun as SQLite driver

## Status

Accepted

## Context

`packages/core` previously implemented a bespoke `SqliteApi` over `bun:sqlite` directly. Effect v4 ships `effect/unstable/sql` (`SqlClient`, `SqlModel.makeRepository`, `SqlModel.makeResolvers`) and `@effect/sql-sqlite-bun` as a first-party Bun SQLite driver. Every internal storage call-site (event log, settings) re-derived row encoding by hand, with no typed repositories and no migration story. The upstream module owns these primitives and tracks Effect API changes automatically.

## Decision

Add `@effect/sql-sqlite-bun@4.0.0-beta.60` (matching the Effect `^4.0.0-beta.60` peer) as a production dependency of `@orika/core`. Expose `SqlClient`, `SqlError`, `SqlModel`, and the concrete `SqliteClient` namespace as re-exports from `runtime/sqlite.ts`. Provide `SqlClientLive(config)` as the canonical desktop policy layer for runtime SQLite call-sites.

Issue #1267 completed the planned removal. The bespoke `SQLite` service,
`SQLiteLive`, `makeSQLite`, connection, statement, transaction, and local driver
error surfaces are gone. `SqlClientLive` remains only as the desktop policy
layer over `@effect/sql-sqlite-bun`: it validates the filename and owner scope,
checks `sqlite.open` for file-backed databases, registers a scoped
`ResourceRegistry` handle, and delegates SQL execution to Effect.

## Alternatives considered

- **`@effect/sql-sqlite-node` with `better-sqlite3`**: Avoids the beta dependency but adds a native binding and loses `bun:sqlite` WAL defaults. Rejected because `@effect/sql-sqlite-bun` v4 beta tracks the same Effect beta and is the natural fit for a Bun-first framework.
- **Keep bespoke surface only**: Indefinitely drifts from upstream APIs. Every new Effect release is a manual porting cost.

## Consequences

- One new production dependency (`@effect/sql-sqlite-bun`), which itself has zero transitive npm deps (uses `bun:sqlite` built-in).
- `SqlClientLive(config)` is the new canonical entry point for storage. It registers the connection in `ResourceRegistry` under `kind: "sqlite"`, `state: "open"`, so disposal participates in scope-tracked runtime shutdown.
- The bespoke `SQLite` / `SQLiteLive` surface has been deleted; application and framework storage code uses `SqlClient` / `SqlModel`.
- `Model.Class` + `Model.makeRepository` is now the authorized pattern for typed CRUD against any table.

## Validation

`bun test packages/core` passes all 745 tests. `bun run typecheck`, `bun run lint`, and `bun run format:check` all exit clean.

## Migration notes

Call-sites that used to do `yield* SQLite` then `sqlite.connect(...)` should migrate to:

```ts
const sql = yield * SqlClient
```

provided by `SqlClientLive({ filename, ownerScope })`. Repositories use `SqlModel.makeRepository(Model, { tableName, spanPrefix, idColumn })`.
