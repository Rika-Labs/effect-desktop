---
title: Storage
description: Settings, Secrets, SqlClient, EventLog, and renderer-side stores.
kind: reference
audience: app-developers
effect_version: 4
---

# Storage

> Full references: [`reference/services/settings.md`](reference/services/settings.md), [`reference/services/secrets.md`](reference/services/secrets.md), [`reference/services/sqlite.md`](reference/services/sqlite.md), [`reference/platform-browser.md`](reference/platform-browser.md).

Effect Desktop has separate storage surfaces for renderer persistence, runtime settings, secrets, SQLite, and event logs.

## Runtime storage

`@effect-desktop/core` exports:

- `Settings` for typed runtime settings.
- `Secrets` and safe-storage helpers for secret material.
- `SqlClient` and `SqlClientLive` for runtime SQLite ownership.
- Event log and telemetry surfaces for operational records.

## Renderer storage

`@effect-desktop/platform-browser` exports browser persistence helpers, IndexedDB helpers, SQLite WASM layers (`RendererSqliteWorkerLive`), and PGlite layers (`RendererPgliteLive`).

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
