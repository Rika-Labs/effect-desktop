---
title: How to use SQLite
description: Reach for SqlClient when Settings outgrows itself.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to use SQLite

`SqlClient` is the Effect SQL service backed by `bun:sqlite`. Use it for richer queries than `Settings` can express — joins, indexes, multiple tables, full-text search.

## 1. Layer setup

```ts
import { BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import {
  PermissionRegistry,
  ResourceOwner,
  ResourceRegistryLive,
  SqlClient,
  SqlClientLive
} from "@orika/core"

const SqliteLive = SqlClientLive({
  filename: "app.sqlite"
})

const PermissionsLive = Layer.unwrap(
  Effect.gen(function* () {
    const permissions = yield* PermissionRegistry.make
    yield* permissions.declare(
      { kind: "sqlite.open", roots: [process.cwd()], audit: "always" },
      { effect: "allow", source: "app-init" }
    )
    return Layer.succeed(PermissionRegistry, permissions)
  })
)

const program = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, body TEXT, updated_at INTEGER)`
})

await Effect.runPromise(
  program.pipe(
    Effect.provide(SqliteLive),
    Effect.provide(ResourceOwner.app("dev.example.notes")),
    Effect.provide(PermissionsLive),
    Effect.provide(ResourceRegistryLive),
    Effect.provide(BunServices.layer),
    Effect.scoped
  )
)
```

`SqlClientLive` validates the path, checks the `sqlite.open` permission, registers a scoped `sqlite` resource under the current `ResourceOwner`, and delegates everything else to `@effect/sql-sqlite-bun`. `Desktop.runtime(...)` provides the app owner automatically; the explicit `ResourceOwner.app(...)` above is only for this standalone layer example.

## 2. Queries

```ts
const rows =
  yield *
  sql<{ id: string; body: string }>`
  SELECT id, body FROM notes WHERE updated_at > ${cutoff}
`
```

The tagged template handles parameter binding safely.

## 3. Transactions

```ts
yield *
  sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`INSERT INTO notes (id, body, updated_at) VALUES (${id}, ${body}, ${now})`
      yield* sql`UPDATE counters SET writes = writes + 1`
    })
  )
```

`withTransaction` rolls back on failure or interruption.

## 4. Repositories with SqlModel

For typed table access:

```ts
import { Schema } from "effect"
import { SqlModel } from "@orika/core"

class Note extends Schema.Class<Note>("Note")({
  id: Schema.String,
  body: Schema.String,
  updatedAt: Schema.Number
}) {}

const NoteRepo = yield * SqlModel.makeRepository(Note, { tableName: "notes", idColumn: "id" })

yield * NoteRepo.insertVoid(new Note({ id, body, updatedAt: Date.now() }))
const found = yield * NoteRepo.findById(id)
```

The repository handles encoding/decoding through the Schema.

## 5. Permissions

```ts
yield *
  permissions.declare(
    { kind: "sqlite.open", roots: [process.cwd()] },
    { effect: "allow", source: "app-init" }
  )
```

`sqlite.open` is checked once when the layer opens; queries on the open connection don't re-check.

## When NOT to use SQLite

- For preferences and small key/value, `Settings` is friendlier.
- For renderer-side persistence in a browser context, import `SqliteClient`
  directly from `@effect/sql-sqlite-wasm` and use `SqliteClient.layer`
  (SQLite WASM in a Web Worker), or use `RendererPgliteLive` from
  `@orika/platform-browser/sql-pglite` when you need PGlite.

## Related

- Reference: [`SqlClient`](../reference/services/sqlite.md), [`Settings`](../reference/services/settings.md)
- How-to: [Persist settings](persist-settings.md)
