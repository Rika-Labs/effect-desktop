---
title: Storage
description: Settings, Secrets, SqlClient, EventLog, and renderer-side stores.
kind: reference
audience: app-developers
effect_version: 4
---

# Storage

> Full references: [`reference/services/settings.md`](reference/services/settings.md), [`reference/services/secrets.md`](reference/services/secrets.md), [`reference/services/sqlite.md`](reference/services/sqlite.md), [`reference/platform-browser.md`](reference/platform-browser.md).

ORIKA has separate storage surfaces for renderer persistence, runtime settings, secrets, SQLite, and event logs.

## Runtime storage

`@orika/core` exports:

- `Settings` for typed runtime settings.
- `Secrets` and safe-storage helpers for secret material.
- `SqlClient` and `SqlClientLive` for runtime SQLite ownership.
- Event log and telemetry surfaces for operational records.

## Renderer storage

`@orika/platform-browser` exports browser persistence helpers and IndexedDB helpers; the optional PGlite boundary (`RendererPgliteLive`) lives on the `@orika/platform-browser/sql-pglite` subpath so the optional Postgres engine never lands in a renderer bundle unless you opt in. For SQLite WASM, import `SqliteClient` directly from `@effect/sql-sqlite-wasm` and use its `layer` or `layerMemory`.

These renderer-side layers are not native browsing-data controls. For
host-backed control, `@orika/native` exposes the `BrowsingData` service
(`clear`/`listTypes`/`isSupported`/`events`) to clear WebView cache, cookies,
local storage, IndexedDB, history, or service workers, scoped by
`SessionProfileResource` and `BrowsingDataType`. Cookie read, write, remove,
and watch operations live on the `CookieStore` service
(`get`/`set`/`remove`/`isSupported` plus an `events` stream), which requires a
live WebView. See [`reference/native/browsing-data.md`](reference/native/browsing-data.md)
and [`reference/native/cookie-store.md`](reference/native/cookie-store.md).

## Verify Storage Test Surface

```ts run
import { Settings } from "../packages/core/src/index.js"

const testDouble = "MemorySecretsSafeStorage"

if (Settings === undefined || testDouble.length === 0) {
  throw new Error("Settings or MemorySecretsSafeStorage is unavailable")
}
```

## Rule

Use **schemas** for stored data. Treat migrations as startup work. Keep secrets in `Redacted` values and only persist them through a SafeStorage adapter that fails loudly when platform storage is unavailable.

## Where to go next

- [How-to: persist settings](how-to/persist-settings.md)
- [How-to: store secrets safely](how-to/store-secrets.md)
- [How-to: use SQLite](how-to/use-sqlite.md)
- [`Settings`](reference/services/settings.md), [`Secrets`](reference/services/secrets.md), [`SqlClient`](reference/services/sqlite.md), [Platform browser](reference/platform-browser.md)
