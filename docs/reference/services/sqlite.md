---
title: SqlClient (SQLite)
description: Effect SQL service backed by bun:sqlite.
kind: reference
audience: app-developers
effect_version: 4
---

# `SqlClient`

Effect SQL service backed by `bun:sqlite` via `@effect/sql-sqlite-bun`. The framework adds boundary validation, scope-bound resource registration, and `sqlite.open` permission enforcement.

## Import

```ts
import { SqlClient, SqlClientLive } from "@orika/core"
```

`SqlClient`, `SqlError`, and `SqlModel` re-export from `@effect/sql-sqlite-bun`.

## Layer

```ts
const SqliteLive = SqlClientLive({
  filename: "app.sqlite" // or ":memory:"
})
```

`SqlClientLive`:

- Validates the path.
- Checks the `sqlite.open` permission for file-backed databases.
- Registers a scoped `sqlite` resource under the current `ResourceOwner`.
- Delegates query execution, transactions, prepared statements, and driver errors to `@effect/sql-sqlite-bun`.

`Desktop.runtime(...)` provides an app owner. `Desktop.window(..., services)` provides a window owner for window-scoped layers. Tests can provide `ResourceOwner.test(...)`.

## Queries

```ts
const sql = yield * SqlClient

yield * sql`CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT)`

const rows =
  yield *
  sql<{ id: string; body: string }>`
  SELECT id, body FROM notes WHERE updated_at > ${cutoff}
`
```

Tagged template handles parameter binding safely.

## Transactions

```ts
yield *
  sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`INSERT INTO notes (id, body) VALUES (${id}, ${body})`
      yield* sql`UPDATE counters SET writes = writes + 1`
    })
  )
```

Rolls back on failure or interruption.

## Repositories

```ts
import { SqlModel } from "@effect/sql"

const NoteRepo = yield * SqlModel.makeRepository(Note, { tableName: "notes", idColumn: "id" })

yield * NoteRepo.insertVoid(new Note({ id, body, updatedAt: Date.now() }))
const found = yield * NoteRepo.findById(id)
```

## Permissions

`sqlite.open` capability declared at startup. Queries on the open connection don't re-check.

## Platform

Bun-only. SQLite uses Bun's built-in `bun:sqlite` binding.

## Renderer-side equivalent

For renderer persistence, import `SqliteClient` directly from
`@effect/sql-sqlite-wasm` and use `SqliteClient.layer` or
`SqliteClient.layerMemory`. ORIKA does not wrap those upstream Effect layers.

## Related

- How-to: [Use SQLite](../../how-to/use-sqlite.md)
- Reference: [`Settings`](settings.md), [Platform browser](../platform-browser.md)
- Source: [`packages/core/src/runtime/sqlite.ts`](../../../packages/core/src/runtime/sqlite.ts)
