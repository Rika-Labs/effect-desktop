---
title: Settings
description: Typed key/value store with versioned migrations and transactional updates.
kind: reference
audience: app-developers
effect_version: 4
---

# `Settings`

Typed key/value store built on Effect `KeyValueStore` and `SqlClient`. Use it for preferences, feature flags, and small configuration values. Use `SqlClient` for app records and query-shaped data.

## Import

```ts
import {
  Settings,
  type SettingsApi,
  type Store,
  SettingsError,
  SettingsMigrated,
  SettingsRecoveredFromBackup
} from "@effect-desktop/core"
```

## API

```ts
const store = yield * Settings
```

`Settings.layer(...)` provides a SQLite-backed store:

```ts
Settings.layer({
  path: "preferences.sqlite",
  schemaVersion: 1,
  backupPath: "preferences.backup.sqlite",
  migrations: []
})
```

`Settings.window(...)` provides the same store for a `Desktop.window(...)` service layer and binds ownership to that window's `ResourceOwner`. `Settings.memory(...)` provides an in-memory store for tests.

`Store` / `SettingsApi`:

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

When the layer detects corruption and a `backupPath` is provided, Settings replaces the corrupt file with the backup and reopens it. A failed copy returns `SettingsRecoveredFromBackup`.

## Errors

- `SettingsError.InvalidArgument`, `SchemaMismatch`, `MigrationFailed`, `Corrupt`.
- `SettingsRecoveredFromBackup` (informational).
- `SettingsMigrated` (informational).

## Layer

`Settings.layer(options)` returns a layer that depends on `ResourceOwner`, `PermissionRegistry`, and `ResourceRegistry`.

`Settings.window(options)` returns the same layer shape. `Desktop.window(...)` supplies a window `ResourceOwner` automatically for its third-argument services layer.

`Settings.memory(options?)` returns an in-memory layer with no external dependencies.

## Example

```ts
const program = Effect.gen(function* () {
  const store = yield* Settings
  yield* store.set("theme", Schema.Literals(["light", "dark"]), "dark")
  return yield* store.getOrDefault("theme", Schema.Literals(["light", "dark"]), "light")
}).pipe(
  Effect.provide(
    Settings.layer({
      path: "settings.sqlite",
      schemaVersion: 1
    })
  )
)
```

## Related

- How-to: [Persist settings](../../how-to/persist-settings.md)
- Reference: [`SqlClient`](sqlite.md)
- Source: [`packages/core/src/runtime/settings.ts`](../../../packages/core/src/runtime/settings.ts)
