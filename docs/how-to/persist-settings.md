---
title: How to persist settings
description: Use the typed Settings store backed by SQLite for app preferences and configuration.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to persist settings

`Settings` is a typed key/value store backed by SQLite. Use it for preferences, feature flags, and small configuration values. Use `SqlClient` for app records and query-shaped data.

## 1. Open a store

```ts
import { Effect, Schema } from "effect"
import { Settings } from "@orika/core"

const program = Effect.gen(function* () {
  const store = yield* Settings

  // use store.get, store.set, store.update, store.delete, store.keys
}).pipe(
  Effect.provide(
    Settings.layer({
      path: "preferences.sqlite",
      schemaVersion: 1
    })
  )
)
```

`Settings.layer` validates the path, opens (or creates) the SQLite file, and registers a scoped resource. When the layer scope closes, the store closes. Use `Settings.window(...)` inside `Desktop.window(..., services)` when the store should be owned by one window.

## 2. Read and write typed values

```ts
const Theme = Schema.Literals(["light", "dark", "system"])

// Read with a default
const theme = yield * store.getOrDefault("theme", Theme, "system")

// Write
yield * store.set("theme", Theme, "dark")

// Read or fail
const required = yield * store.get("apiBaseUrl", Schema.String)
//             ^? Effect<string, SettingsError | NotFound, never>

// Update inside a transaction
yield *
  store.update(
    "counters",
    Schema.Record({ key: Schema.String, value: Schema.Number }),
    (counts) => ({ ...counts, opens: (counts.opens ?? 0) + 1 })
  )
```

Every read decodes through the schema. Every write encodes. Mismatched data fails at the boundary, not deep in your component.

## 3. Migrate when you change the shape

Pass a `migrations` array on the layer to handle version bumps:

```ts
const settingsLayer = Settings.layer({
  path: "preferences.sqlite",
  schemaVersion: 2,
  migrations: [
    {
      from: 1,
      to: 2,
      migrate: (raw) => {
        // raw is the stored object
        return { ...raw, theme: raw.theme ?? "system" }
      }
    }
  ]
})
```

Migrations run inside a SQLite transaction with the metadata update. They emit `SettingsMigrated` events through `migrated()`.

## 4. Subscribe to changes

```ts
yield *
  store
    .changes()
    .pipe(
      Stream.runForEach((change) =>
        Effect.log(`${change.key} changed: ${change.oldValue} -> ${change.newValue}`)
      )
    )
```

`changes()` emits `{ key, oldValue, newValue, source }` on every write. Useful for cross-window sync (one window writes, another reacts).

## 5. Recover from corruption

If the database file is corrupt when the layer opens and you supply `backupPath`, Settings replaces the corrupt file with the backup and reopens it:

```ts
const settingsLayer = Settings.layer({
  path: "preferences.sqlite",
  schemaVersion: 1,
  backupPath: "preferences.backup.sqlite"
})
```

A failed copy returns `SettingsRecoveredFromBackup` rather than throwing.

## When NOT to use Settings

Reach for `SqlClient` directly when you need:

- App entities such as notes, tasks, documents, or events.
- Joins, indexes, or queries beyond `getOrDefault`.
- Data large enough to benefit from columnar access.
- Multiple tables.

`Settings` is built on `SqlClient`; switching is straightforward when you outgrow it.

## Related

- Reference: [`Settings`](../reference/services/settings.md), [`SqlClient`](../reference/services/sqlite.md)
- How-to: [Use SQLite](use-sqlite.md), [Store secrets safely](store-secrets.md)
