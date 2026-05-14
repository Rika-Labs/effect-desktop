---
title: Settings
description: Typed key/value store with versioned migrations and transactional updates.
kind: reference
audience: app-developers
effect_version: 4
---

# `Settings`

Typed key/value store built on Effect `KeyValueStore` and `SqlClient`. Used for preferences, small per-user data, anything you'd reach for `localStorage` to do.

## Import

```ts
import {
  Settings,
  type SettingsApi,
  type Store,
  SettingsError,
  SettingsMigrated,
  SettingsRecoveredFromBackup,
  makeSettingsLayer
} from "@effect-desktop/core"
```

## API

```ts
const settings = yield* Settings
const store = yield* settings.open({
  path: "preferences.sqlite",
  ownerScope: "window-main",
  schemaVersion: 1,
  backupPath?: "preferences.backup.sqlite",
  migrations?: Migration[]
})
```

`Store`:

| Method         | Signature                                               |
| -------------- | ------------------------------------------------------- |
| `get`          | `(key, schema) => Effect<A, SettingsError \| NotFound>` |
| `getOrDefault` | `(key, schema, default) => Effect<A>`                   |
| `set`          | `(key, schema, value) => Effect<void>`                  |
| `delete`       | `(key) => Effect<void>`                                 |
| `keys`         | `() => Effect<string[]>`                                |
| `update`       | `(key, schema, fn) => Effect<void>` (transactional)     |
| `changes`      | `() => Stream<{ key, oldValue, newValue, source }>`     |
| `migrated`     | `() => Stream<SettingsMigrated>`                        |

## Migrations

```ts
migrations: [
  {
    from: 1,
    to: 2,
    migrate: (raw) => ({ ...raw, theme: raw.theme ?? "system" })
  }
]
```

Migrations run inside a SQLite transaction with the metadata update. Emit `SettingsMigrated` events through `migrated()`.

## Recovery

When `open` detects corruption and a `backupPath` is provided, Settings replaces the corrupt file with the backup and reopens it. A failed copy returns `SettingsRecoveredFromBackup`.

## Errors

- `SettingsError.InvalidArgument`, `SchemaMismatch`, `MigrationFailed`, `Corrupt`.
- `SettingsRecoveredFromBackup` (informational).
- `SettingsMigrated` (informational).

## Layer

`makeSettingsLayer(filename, ownerScope)` returns a layer that depends on `SqlClient`, `PermissionRegistry`, and `ResourceRegistry`.

## Example

```ts
const program = Effect.gen(function* () {
  const settings = yield* Settings
  const store = yield* settings.open({
    path: "settings.sqlite",
    ownerScope: "window-main",
    schemaVersion: 1
  })
  yield* store.set("theme", Schema.Literals(["light", "dark"]), "dark")
  return yield* store.getOrDefault("theme", Schema.Literals(["light", "dark"]), "light")
})
```

## Related

- How-to: [Persist settings](../../how-to/persist-settings.md)
- Reference: [`SqlClient`](sqlite.md)
- Source: [`packages/core/src/runtime/settings.ts`](../../../packages/core/src/runtime/settings.ts)
