---
title: How to persist settings
description: Use the typed Settings store backed by SQLite for app preferences and small data.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to persist settings

`Settings` is a typed key/value store backed by SQLite. Use it for preferences, small per-user data, and anything you'd reach for `localStorage` to do — but with schemas, transactions, and migrations.

## 1. Open a store

```ts
import { Effect, Schema } from "effect"
import { Settings } from "@effect-desktop/core"

const program = Effect.gen(function* () {
  const settings = yield* Settings
  const store = yield* settings.open({
    path: "preferences.sqlite",
    ownerScope: "window-main",
    schemaVersion: 1
  })

  // use store.get, store.set, store.update, store.delete, store.keys
})
```

`Settings.open` validates the path and owner scope, opens (or creates) the SQLite file, and registers a scoped resource. When `"window-main"` closes, the store closes.

## 2. Read and write typed values

```ts
const Theme = Schema.Literals(["light", "dark", "system"])

// Read with a default
const theme = yield* store.getOrDefault("theme", Theme, "system")

// Write
yield* store.set("theme", Theme, "dark")

// Read or fail
const required = yield* store.get("apiBaseUrl", Schema.String)
//             ^? Effect<string, SettingsError | NotFound, never>

// Update inside a transaction
yield* store.update("counters", Schema.Record({ key: Schema.String, value: Schema.Number }),
  (counts) => ({ ...counts, opens: (counts.opens ?? 0) + 1 })
)
```

Every read decodes through the schema. Every write encodes. Mismatched data fails at the boundary, not deep in your component.

## 3. Migrate when you change the shape

Pass a `migrations` array on `open` to handle version bumps:

```ts
const store = yield* settings.open({
  path: "preferences.sqlite",
  ownerScope: "window-main",
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
yield* store.changes().pipe(
  Stream.runForEach((change) =>
    Effect.log(`${change.key} changed: ${change.oldValue} -> ${change.newValue}`)
  )
)
```

`changes()` emits `{ key, oldValue, newValue, source }` on every write. Useful for cross-window sync (one window writes, another reacts).

## 5. Recover from corruption

If the database file is corrupt at open and you supply `backupPath`, Settings replaces the corrupt file with the backup and reopens it:

```ts
const store = yield* settings.open({
  path: "preferences.sqlite",
  ownerScope: "window-main",
  schemaVersion: 1,
  backupPath: "preferences.backup.sqlite"
})
```

A failed copy returns `SettingsRecoveredFromBackup` rather than throwing.

## When NOT to use Settings

Reach for `SqlClient` directly when you need:

- Joins, indexes, or queries beyond `getOrDefault`.
- Data large enough to benefit from columnar access.
- Multiple tables.

`Settings` is built on `SqlClient`; switching is straightforward when you outgrow it.

## Related

- Reference: [`Settings`](../reference/services/settings.md), [`SqlClient`](../reference/services/sqlite.md)
- How-to: [Use SQLite](use-sqlite.md), [Store secrets safely](store-secrets.md)
