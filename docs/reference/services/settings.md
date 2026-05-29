---
title: Settings
description: Typed key/value store with versioned migrations and transactional updates.
kind: reference
audience: app-developers
effect_version: 4
---

# `Settings`

Typed key/value store built on Effect's `KeyValueStore`. The default `Settings.layer(...)` backs the store with `SqlClient` so values persist in SQLite; `Settings.memory(...)` returns an in-memory store with no external dependencies. Use it for preferences, feature flags, and small configuration values. Use `SqlClient` for app records and query-shaped data.

## Import

```ts
import {
  Settings,
  makeSettingKey,
  type SettingsApi,
  type SettingKey,
  type SettingsError,
  type SettingsMigration,
  type SettingsMigrationContext,
  type SettingsMutationOptions,
  SettingsChange,
  SettingsMigrated
} from "@orika/core"
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
  namespace: "preferences",
  backupPath: "preferences.backup.sqlite",
  migrations: []
})
```

`namespace` defaults to `"default"` and prefixes every stored key so multiple `Settings` layers can share one SQLite file. Pass `Settings.layer(...)` directly as a `Desktop.window(...)` service layer when the store should be owned by one window. `Settings.memory(...)` provides an in-memory store for tests.

`SettingsApi`:

| Method         | Signature                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `key`          | `({ name, schema, defaultValue? }) => SettingKey<A>`                                                   |
| `get`          | `(key, schema?) => Effect<Option<A>, SettingsError>`                                                   |
| `getOrDefault` | `(key, schema?, default?) => Effect<A, SettingsError>`                                                 |
| `set`          | `(key, schema, value, options?) => Effect<void, SettingsError>`                                        |
| `set`          | `(SettingKey<A>, value, options?) => Effect<void, SettingsError>`                                      |
| `delete`       | `(key, options?) => Effect<void, SettingsError>`                                                       |
| `keys`         | `() => Effect<readonly string[], SettingsError>`                                                       |
| `update`       | `(key, schema, (current: Option<A>) => Effect<A, E, R>, options?) => Effect<A, SettingsError \| E, R>` |
| `changes`      | `() => Stream<SettingsChange>`                                                                         |
| `migrated`     | `() => Stream<SettingsMigrated>`                                                                       |
| `close`        | `() => Effect<void>`                                                                                   |

`get` returns `Option.none()` when the key is unset; `getOrDefault` falls back to the explicit `default`, the `SettingKey.defaultValue`, or fails with `InvalidArgument` if neither is present. `update` reads the current value, runs the user effect, and writes the result. `set`/`delete`/`update` accept an optional `{ source?: string }` mutation tag that flows through `SettingsChange.source` (default `"set" | "delete" | "update"`).

Use `makeSettingKey({ name, schema, defaultValue? })` to bundle a key with its schema so call sites don't repeat the schema.

## Migrations

```ts
migrations: [
  {
    from: 1,
    to: 2,
    migrate: (ctx) =>
      Effect.gen(function* () {
        const current = yield* ctx.getRaw("theme")
        yield* ctx.setRaw(
          "theme",
          Option.getOrElse(current, () => "system")
        )
      })
  }
]
```

`SettingsMigrationContext` exposes `getRaw`, `setRaw`, `deleteRaw`, and `rename`. Migrations run sequentially during layer initialization until `schemaVersion` matches, then the new version is persisted and a `SettingsMigrated { from, to, durationMs }` event is published.

## Recovery

When the layer is configured with `backupPath`, the input is decoded eagerly so a malformed backup path fails fast. The current implementation does not yet automatically restore from the backup file; `SettingsRecoveredFromBackupError` is the typed failure shape callers should match if you wire your own recovery on top.

## Errors

`SettingsError` is the union of:

- `SettingsInvalidArgumentError` (`_tag: "InvalidArgument"`) — payload, schema, key, or stored value rejected.
- `SettingsKvError` (`_tag: "KvError"`) — underlying `KeyValueStore` raised.
- `SettingsMigrationFailedError` (`_tag: "SettingsMigrationFailed"`) — missing, non-advancing, or failing migration.
- `SettingsRecoveredFromBackupError` (`_tag: "SettingsRecoveredFromBackup"`) — informational backup recovery.

`Settings.layer(...)` additionally surfaces `SqlitePolicyError` (`SqliteInvalidArgumentError` or `PermissionRegistryError`) when the underlying SQLite layer rejects the path.

## Layer

`Settings.layer(options)` depends on `ResourceOwner | PermissionRegistry | ResourceRegistry | FileSystem | Path`; the SQLite filename is authorized through `sqlite.open` before the KV store is built.

`Settings.memory(options?)` returns an in-memory layer with no external dependencies and ignores `path`/`backupPath`.

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
