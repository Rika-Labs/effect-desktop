---
title: Platform browser
description: Renderer-side IndexedDB, SQLite WASM, and PGlite layers.
kind: reference
audience: app-developers
effect_version: 4
---

# Platform browser

`@orika/platform-browser` exposes Effect layers for renderer-side persistence — IndexedDB, SQLite WASM (in a Web Worker), and PGlite.

This package does not clear native WebView browsing data. Cache, cookies, local
storage, IndexedDB, and history remain under the host WebView data store, and
ORIKA does not yet expose a profile/session-partitioned clearing API.
It also does not provide native cookie read, write, remove, or watch behavior.

## Import

```ts
import {
  RendererSqliteMemoryLive,
  RendererSqliteWorkerLive,
  RendererPgliteLive,
  BrowserContext
} from "@orika/platform-browser"
```

## SQLite WASM

`RendererSqliteMemoryLive(options)` — in-memory SQLite via `@effect/sql-sqlite-wasm`.

`RendererSqliteWorkerLive(options)` — SQLite in a Web Worker, for heavier queries off the main thread.

```ts
import { Effect, Layer } from "effect"
import { SqlClient } from "@effect/sql-sqlite-wasm"
import { RendererSqliteWorkerLive } from "@orika/platform-browser"

const SqliteLive = RendererSqliteWorkerLive({ filename: "renderer.sqlite" })

const program = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS notes (id TEXT, body TEXT)`
})

await Effect.runPromise(program.pipe(Effect.provide(SqliteLive)))
```

## PGlite

`RendererPgliteLive(options)` — Postgres-compatible storage via `@electric-sql/pglite`. Requires the optional `@effect/sql-pglite` and `@electric-sql/pglite` packages installed in your renderer.

```ts
const PgliteLive = RendererPgliteLive({
  connectionString: "idb://renderer-db"
})
```

## IndexedDB

Re-exports from `@effect/platform-browser`:

- `BrowserHttpClient`, `BrowserKeyValueStore`, `BrowserPersistence`
- `IndexedDb`, `IndexedDbDatabase`, `IndexedDbQueryBuilder`, `IndexedDbTable`, `IndexedDbVersion`
- `BrowserContext` — `{ layer }` factory

For typed IndexedDB tables:

```ts
import { IndexedDb, IndexedDbTable } from "@orika/platform-browser"

const NotesTable = IndexedDbTable.makeTableSchema("notes", { keyPath: "id" })

const dbLayer = IndexedDb.layer({ name: "notes-db", version: 1, tables: [NotesTable] })
```

## Storage layers

`./storage/idb.ts` — IndexedDB-backed key/value store layer.

`./storage/kv.ts` — generic key/value store layer (memory or IndexedDB).

## When to use what

| Need                                               | Use                                 |
| -------------------------------------------------- | ----------------------------------- |
| Small key/value, occasional reads                  | IndexedDB or `BrowserKeyValueStore` |
| Tabular data, joins, aggregates                    | `RendererSqliteWorkerLive`          |
| Postgres-compatible queries, syncing with a server | `RendererPgliteLive`                |
| Anything that should survive the renderer reload   | All of the above (IndexedDB-backed) |

## Why renderer-side storage matters

The runtime owns the canonical app state via `Settings` and `SqlClient`. Renderer-side stores are for **per-window UI state**, **caches**, and **offline-first views** — things you want available immediately without an RPC round trip.

## Related

- Reference: [`Settings`](services/settings.md), [`SqlClient`](services/sqlite.md)
- Source: [`packages/platform-browser/src/index.ts`](../../packages/platform-browser/src/index.ts)
