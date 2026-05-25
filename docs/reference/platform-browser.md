---
title: Platform browser
description: Renderer-side IndexedDB helpers and the optional PGlite boundary.
kind: reference
audience: app-developers
effect_version: 4
---

# Platform browser

`@orika/platform-browser` exposes Effect layers for renderer-side persistence — IndexedDB helpers from `@effect/platform-browser` and ORIKA's optional PGlite dependency boundary.

This package does not clear native WebView browsing data. Cache, cookies, local
storage, IndexedDB, and history remain under the host WebView data store, and
ORIKA does not yet expose a profile/session-partitioned clearing API.
It also does not provide native cookie read, write, remove, or watch behavior.

## Import

```ts
import { RendererPgliteLive } from "@orika/platform-browser"
```

## SQLite WASM

ORIKA does not wrap SQLite WASM. Import the upstream Effect package directly.

`SqliteWasmClient.layerMemory(options)` — in-memory SQLite via `@effect/sql-sqlite-wasm`.

`SqliteWasmClient.layer(options)` — SQLite in a Web Worker, for heavier queries off the main thread.

```ts
import { Effect } from "effect"
import { SqliteClient as SqliteWasmClient } from "@effect/sql-sqlite-wasm"
import { SqlClient } from "effect/unstable/sql"

const worker = Effect.acquireRelease(
  Effect.sync(() => new Worker(new URL("./sqlite-worker.ts", import.meta.url), { type: "module" })),
  (worker) => Effect.sync(() => worker.terminate())
)

const SqliteLive = SqliteWasmClient.layer({ worker })

const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS notes (id TEXT, body TEXT)`
})

await Effect.runPromise(program.pipe(Effect.provide(SqliteLive)))
```

## PGlite

`RendererPgliteLive(options)` — Postgres-compatible storage via `@electric-sql/pglite`. Requires the optional `@effect/sql-pglite` and `@electric-sql/pglite` packages installed in your renderer. Use `dataDir` for a PGlite storage location such as IndexedDB-backed browser storage.

```ts
const PgliteLive = RendererPgliteLive({
  dataDir: "idb://renderer-db"
})
```

Packaged macOS system WebView QA verifies this path under the fixed
`app://localhost` renderer scheme when the renderer bundles PGlite's WASM and
data assets.

## IndexedDB

Re-exports from `@effect/platform-browser`:

- `BrowserHttpClient`, `BrowserKeyValueStore`, `BrowserPersistence`
- `IndexedDb`, `IndexedDbDatabase`, `IndexedDbQueryBuilder`, `IndexedDbTable`, `IndexedDbVersion`
- `IndexedDb.layerWindow` — browser `window.indexedDB` service layer

For typed IndexedDB tables:

```ts
import { Effect, Schema } from "effect"
import {
  IndexedDb,
  IndexedDbDatabase,
  IndexedDbTable,
  IndexedDbVersion
} from "@orika/platform-browser"

const NotesTable = IndexedDbTable.make({
  name: "notes",
  schema: Schema.Struct({
    id: Schema.String,
    body: Schema.String
  }),
  keyPath: "id"
})

const NotesV1 = IndexedDbVersion.make(NotesTable)

class NotesDb extends IndexedDbDatabase.make(NotesV1, (tx) =>
  tx.createObjectStore("notes").pipe(Effect.asVoid)
) {}

const program = Effect.gen(function* () {
  const db = yield* NotesDb.getQueryBuilder
  yield* db.from("notes").insert({ id: "first", body: "Draft" })
  return yield* db.from("notes").select()
})

await Effect.runPromise(
  program.pipe(Effect.provide(NotesDb.layer("notes-db")), Effect.provide(IndexedDb.layerWindow))
)
```

## Storage layers

Use `BrowserKeyValueStore.layerLocalStorage` or
`BrowserKeyValueStore.layerSessionStorage` directly for browser key/value
storage. ORIKA does not wrap those upstream Effect layers.

Use `IndexedDbTable`, `IndexedDbVersion`, and `IndexedDbDatabase` directly for
typed IndexedDB. ORIKA does not expose constructor-alias subpaths over the
upstream Effect modules.

## When to use what

| Need                                               | Use                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| Small key/value, occasional reads                  | IndexedDB or `BrowserKeyValueStore`                                  |
| Tabular data, joins, aggregates                    | `SqliteWasmClient.layer` from `@effect/sql-sqlite-wasm`              |
| Postgres-compatible queries, syncing with a server | `RendererPgliteLive` with a browser storage `dataDir`                |
| Anything that should survive the renderer reload   | IndexedDB-backed stores or PGlite with an IndexedDB-backed `dataDir` |

## Why renderer-side storage matters

The runtime owns the canonical app state via `Settings` and `SqlClient`. Renderer-side stores are for **per-window UI state**, **caches**, and **offline-first views** — things you want available immediately without an RPC round trip.

## Related

- Reference: [`Settings`](services/settings.md), [`SqlClient`](services/sqlite.md)
- Source: [`packages/platform-browser/src/index.ts`](../../packages/platform-browser/src/index.ts)
