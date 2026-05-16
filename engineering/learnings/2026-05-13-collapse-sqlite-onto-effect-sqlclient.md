---
date: 2026-05-13
type: in-flight-refactor
topic: Collapse SQLite onto Effect SqlClient
issue: https://github.com/Rika-Labs/effect-desktop/issues/1267
pr: none
---

# Collapse SQLite onto Effect SqlClient

## Decision

Effect SQL should own database semantics; Effect Desktop should only keep the
SQLite boundary code that enforces desktop policy before handing callers a
canonical `SqlClient`.

## What changed

The issue planned to delete the local SQLite connection and statement API. The
implementation went further at the policy boundary: `SqlClientLive` now closes
the scoped SQL client when `ResourceRegistry.closeScope(ownerScope)` runs, and
Settings uses `SqlClientLive` instead of bypassing policy with upstream
`SqliteClient.layer`.

The core runtime no longer exports `SQLite`, `SQLiteLive`, `makeSQLite`, local
connection/statement wrappers, local transaction helpers, bind types, row types,
or local SQLite driver-error classes. Public database code uses Effect
`SqlClient`, `SqlModel`, and the upstream `SqliteClient`.

## Why it mattered

The non-obvious invariant was that resource visibility is not enough. Registering
a `sqlite` resource only helps if closing that resource also closes the scoped
driver; otherwise the registry says the handle is gone while the `SqlClient`
still works. The useful abstraction is therefore not a database wrapper, but a
scope owner for path authorization, resource registration, and driver disposal.

## Example

```ts
const sqlLayer = SqlClientLive({ filename: "todos.db", ownerScope: "main" }).pipe(
  Layer.provide(permissionLayer),
  Layer.provide(registryLayer)
)

const program = Effect.gen(function* () {
  const sql = yield* SqlClient
  return yield* sql.withTransaction(sql`INSERT INTO todos (title) VALUES (${"Ship"})`)
})
```

## Rule candidate

Keep Effect-owned semantics in Effect primitives, but verify that any remaining
desktop policy layer owns real lifecycle effects, not just resource metadata.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it;
`/learn` never auto-edits AGENTS.md.
