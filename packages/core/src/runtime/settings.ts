import { copyFile } from "node:fs/promises"

import { Context, Data, Effect, Option, PubSub, Schema, Stream } from "effect"

import {
  SQLite,
  type SqliteConnection,
  SqliteCorruptError,
  type SqliteError,
  type SqliteRow,
  type SqliteValue
} from "./sqlite.js"

const NonEmptyString = Schema.NonEmptyString
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export class SettingsOpenInput extends Schema.Class<SettingsOpenInput>("SettingsOpenInput")({
  path: NonEmptyString,
  ownerScope: NonEmptyString,
  namespace: NonEmptyString,
  schemaVersion: NonNegativeInt,
  backupPath: Schema.optionalKey(NonEmptyString)
}) {}

export class SettingsChange extends Schema.Class<SettingsChange>("SettingsChange")({
  key: Schema.String,
  oldValue: Schema.optionalKey(Schema.Unknown),
  newValue: Schema.optionalKey(Schema.Unknown),
  source: Schema.String
}) {}

export class SettingsMigrated extends Schema.Class<SettingsMigrated>("SettingsMigrated")({
  from: NonNegativeInt,
  to: NonNegativeInt,
  durationMs: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
}) {}

export class SettingsInvalidArgumentError extends Data.TaggedError("InvalidArgument")<{
  readonly operation: string
  readonly field: string
  readonly message: string
  readonly cause: Option.Option<unknown>
}> {}

export class SettingsSqliteError extends Data.TaggedError("SqliteError")<{
  readonly operation: string
  readonly cause: SqliteError
}> {}

export class SettingsMigrationFailedError extends Data.TaggedError("SettingsMigrationFailed")<{
  readonly schemaVersion: number
  readonly operation: string
  readonly cause: Option.Option<unknown>
}> {}

export class SettingsRecoveredFromBackupError extends Data.TaggedError(
  "SettingsRecoveredFromBackup"
)<{
  readonly backupPath: string
  readonly operation: string
  readonly cause: Option.Option<unknown>
}> {}

export type SettingsError =
  | SettingsInvalidArgumentError
  | SettingsSqliteError
  | SettingsMigrationFailedError
  | SettingsRecoveredFromBackupError

export interface SettingsOpenOptions {
  readonly path: string
  readonly ownerScope: string
  readonly namespace?: string
  readonly schemaVersion: number
  readonly migrations?: readonly SettingsMigration[]
  readonly backupPath?: string
  readonly now?: () => number
}

export interface SettingsMutationOptions {
  readonly source?: string
}

export interface SettingsMigration {
  readonly from: number
  readonly to: number
  readonly migrate: (context: SettingsMigrationContext) => Effect.Effect<void, SettingsError, never>
}

export interface SettingsMigrationContext {
  readonly getRaw: (key: string) => Effect.Effect<Option.Option<unknown>, SettingsError, never>
  readonly setRaw: (key: string, value: unknown) => Effect.Effect<void, SettingsError, never>
  readonly deleteRaw: (key: string) => Effect.Effect<void, SettingsError, never>
  readonly rename: (from: string, to: string) => Effect.Effect<void, SettingsError, never>
}

export interface SettingsStore {
  readonly get: <A>(
    key: string,
    schema: Schema.Schema<A>
  ) => Effect.Effect<Option.Option<A>, SettingsError, never>
  readonly getOrDefault: <A>(
    key: string,
    schema: Schema.Schema<A>,
    defaultValue: A
  ) => Effect.Effect<A, SettingsError, never>
  readonly set: <A>(
    key: string,
    schema: Schema.Schema<A>,
    value: A,
    options?: SettingsMutationOptions
  ) => Effect.Effect<void, SettingsError, never>
  readonly delete: (
    key: string,
    options?: SettingsMutationOptions
  ) => Effect.Effect<void, SettingsError, never>
  readonly keys: () => Effect.Effect<readonly string[], SettingsError, never>
  readonly update: <A, E, R>(
    key: string,
    schema: Schema.Schema<A>,
    update: (current: Option.Option<A>) => Effect.Effect<A, E, R>,
    options?: SettingsMutationOptions
  ) => Effect.Effect<A, E | SettingsError, R>
  readonly changes: () => Stream.Stream<SettingsChange, never, never>
  readonly migrated: () => Stream.Stream<SettingsMigrated, never, never>
  readonly close: () => Effect.Effect<void, never, never>
}

export interface SettingsApi {
  readonly open: (
    options: SettingsOpenOptions
  ) => Effect.Effect<SettingsStore, SettingsError, never>
}

export const makeSettings = (
  sqlite: typeof SQLite.Service
): Effect.Effect<SettingsApi, never, never> =>
  Effect.sync(() =>
    Object.freeze({
      open: (options: SettingsOpenOptions) =>
        Effect.gen(function* () {
          const input = yield* decodeOpenInput(
            {
              path: options.path,
              ownerScope: options.ownerScope,
              namespace: options.namespace ?? "default",
              schemaVersion: options.schemaVersion,
              ...(options.backupPath === undefined ? {} : { backupPath: options.backupPath })
            },
            "Settings.open"
          )
          const changes = yield* PubSub.sliding<SettingsChange>({ capacity: 1024, replay: 0 })
          const migrations = yield* PubSub.sliding<SettingsMigrated>({ capacity: 16, replay: 16 })
          const now = options.now ?? Date.now
          const connection = yield* openConnection(sqlite, input, "Settings.open")
          const recoveredConnection = yield* initialize(
            connection,
            input,
            options.migrations ?? [],
            now,
            migrations
          ).pipe(
            Effect.as(connection),
            Effect.catchTag("SqliteError", (error) =>
              error.cause instanceof SqliteCorruptError && input.backupPath !== undefined
                ? recoverFromBackup(sqlite, connection, input, error.cause).pipe(
                    Effect.flatMap((nextConnection) =>
                      initialize(
                        nextConnection,
                        input,
                        options.migrations ?? [],
                        now,
                        migrations
                      ).pipe(Effect.as(nextConnection))
                    )
                  )
                : Effect.fail(error)
            )
          )

          return makeStore(recoveredConnection, input.namespace, now, changes, migrations)
        }).pipe(
          Effect.withSpan("Settings.open", {
            attributes: {
              path: options.path,
              ownerScope: options.ownerScope,
              namespace: options.namespace ?? "default",
              schemaVersion: options.schemaVersion
            }
          })
        )
    })
  )

export class Settings extends Context.Service<Settings, SettingsApi>()("Settings", {
  make: Effect.gen(function* () {
    const sqlite = yield* SQLite
    return yield* makeSettings(sqlite)
  })
}) {}

const makeStore = (
  connection: SqliteConnection,
  namespace: string,
  now: () => number,
  changes: PubSub.PubSub<SettingsChange>,
  migrations: PubSub.PubSub<SettingsMigrated>
): SettingsStore => {
  const get = <A>(
    key: string,
    schema: Schema.Schema<A>
  ): Effect.Effect<Option.Option<A>, SettingsError, never> =>
    Effect.gen(function* () {
      const validatedKey = yield* decodeKey(key, "Settings.get")
      const raw = yield* readRaw(connection, namespace, validatedKey, "Settings.get")
      if (Option.isNone(raw)) {
        return Option.none()
      }

      return Option.some(yield* decodeValue(schema, raw.value, validatedKey, "Settings.get"))
    }).pipe(Effect.withSpan("Settings.get", { attributes: { namespace, key } }))

  return Object.freeze({
    get,
    getOrDefault: <A>(key: string, schema: Schema.Schema<A>, defaultValue: A) =>
      Effect.gen(function* () {
        const value = yield* get(key, schema)
        return Option.isSome(value) ? value.value : defaultValue
      }),
    set: <A>(key: string, schema: Schema.Schema<A>, value: A, options?: SettingsMutationOptions) =>
      Effect.gen(function* () {
        const validatedKey = yield* decodeKey(key, "Settings.set")
        const encoded = yield* encodeValue(schema, value, validatedKey, "Settings.set")
        const oldValue = yield* readRaw(connection, namespace, validatedKey, "Settings.set")
        yield* writeRaw(connection, namespace, validatedKey, encoded, now(), "Settings.set")
        yield* publishChange(changes, {
          key: validatedKey,
          oldValue: optionToOptional(oldValue),
          newValue: encoded,
          source: options?.source ?? "set"
        })
      }).pipe(Effect.withSpan("Settings.set", { attributes: { namespace, key } })),
    delete: (key: string, options?: SettingsMutationOptions) =>
      Effect.gen(function* () {
        const validatedKey = yield* decodeKey(key, "Settings.delete")
        const oldValue = yield* readRaw(connection, namespace, validatedKey, "Settings.delete")
        yield* exec(
          connection,
          "DELETE FROM settings_values WHERE namespace = ? AND key = ?",
          [namespace, validatedKey],
          "Settings.delete"
        )
        if (Option.isSome(oldValue)) {
          yield* publishChange(changes, {
            key: validatedKey,
            oldValue: oldValue.value,
            newValue: undefined,
            source: options?.source ?? "delete"
          })
        }
      }).pipe(Effect.withSpan("Settings.delete", { attributes: { namespace, key } })),
    keys: () =>
      Effect.gen(function* () {
        const rows = yield* query(
          connection,
          "SELECT key FROM settings_values WHERE namespace = ? ORDER BY key ASC",
          [namespace],
          "Settings.keys"
        )
        return rows.flatMap((row) => {
          const key = row["key"]
          return typeof key === "string" ? [key] : []
        })
      }).pipe(Effect.withSpan("Settings.keys", { attributes: { namespace } })),
    update: <A, E, R>(
      key: string,
      schema: Schema.Schema<A>,
      update: (current: Option.Option<A>) => Effect.Effect<A, E, R>,
      options?: SettingsMutationOptions
    ) =>
      Effect.gen(function* () {
        const validatedKey = yield* decodeKey(key, "Settings.update")
        return yield* connection
          .transaction(
            Effect.gen(function* () {
              const raw = yield* readRaw(connection, namespace, validatedKey, "Settings.update")
              const current = Option.isSome(raw)
                ? Option.some(
                    yield* decodeValue(schema, raw.value, validatedKey, "Settings.update")
                  )
                : Option.none()
              const next = yield* update(current)
              const encoded = yield* encodeValue(schema, next, validatedKey, "Settings.update")
              yield* writeRaw(
                connection,
                namespace,
                validatedKey,
                encoded,
                now(),
                "Settings.update"
              )
              yield* publishChange(changes, {
                key: validatedKey,
                oldValue: optionToOptional(raw),
                newValue: encoded,
                source: options?.source ?? "update"
              })
              return next
            })
          )
          .pipe(Effect.mapError(mapTransactionError))
      }).pipe(Effect.withSpan("Settings.update", { attributes: { namespace, key } })),
    changes: () => Stream.fromPubSub(changes),
    migrated: () => Stream.fromPubSub(migrations),
    close: () => connection.close()
  })
}

const openConnection = (
  sqlite: typeof SQLite.Service,
  input: SettingsOpenInput,
  operation: string
): Effect.Effect<SqliteConnection, SettingsError, never> =>
  sqlite
    .connect({
      path: input.path,
      ownerScope: input.ownerScope,
      create: true,
      strict: true
    })
    .pipe(Effect.mapError((error) => new SettingsSqliteError({ operation, cause: error })))

const initialize = (
  connection: SqliteConnection,
  input: SettingsOpenInput,
  migrations: readonly SettingsMigration[],
  now: () => number,
  migrated: PubSub.PubSub<SettingsMigrated>
): Effect.Effect<void, SettingsError, never> =>
  connection
    .transaction(
      Effect.gen(function* () {
        yield* createTables(connection)
        const current = yield* currentSchemaVersion(connection, input.namespace)
        if (current === input.schemaVersion) {
          return
        }

        if (current === undefined) {
          yield* setSchemaVersion(connection, input.namespace, input.schemaVersion)
          return
        }

        const started = now()
        yield* runMigrations(connection, input.namespace, current, input.schemaVersion, migrations)
        yield* setSchemaVersion(connection, input.namespace, input.schemaVersion)
        yield* PubSub.publish(
          migrated,
          new SettingsMigrated({
            from: current,
            to: input.schemaVersion,
            durationMs: now() - started
          })
        )
      })
    )
    .pipe(Effect.mapError((error) => mapTransactionError(error) as SettingsError))

const createTables = (connection: SqliteConnection): Effect.Effect<void, SettingsError, never> =>
  Effect.gen(function* () {
    yield* exec(
      connection,
      "CREATE TABLE IF NOT EXISTS settings_meta (namespace TEXT PRIMARY KEY, schema_version INTEGER NOT NULL)",
      [],
      "Settings.initialize"
    )
    yield* exec(
      connection,
      "CREATE TABLE IF NOT EXISTS settings_values (namespace TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL, PRIMARY KEY(namespace, key))",
      [],
      "Settings.initialize"
    )
  })

const currentSchemaVersion = (
  connection: SqliteConnection,
  namespace: string
): Effect.Effect<number | undefined, SettingsError, never> =>
  Effect.gen(function* () {
    const rows = yield* query(
      connection,
      "SELECT schema_version FROM settings_meta WHERE namespace = ?",
      [namespace],
      "Settings.initialize"
    )
    const row = rows[0]
    if (row === undefined) {
      return undefined
    }
    const value = row["schema_version"]
    return typeof value === "number" ? value : undefined
  })

const setSchemaVersion = (
  connection: SqliteConnection,
  namespace: string,
  schemaVersion: number
): Effect.Effect<void, SettingsError, never> =>
  exec(
    connection,
    "INSERT INTO settings_meta (namespace, schema_version) VALUES (?, ?) ON CONFLICT(namespace) DO UPDATE SET schema_version = excluded.schema_version",
    [namespace, schemaVersion],
    "Settings.initialize"
  )

const runMigrations = (
  connection: SqliteConnection,
  namespace: string,
  from: number,
  to: number,
  migrations: readonly SettingsMigration[]
): Effect.Effect<void, SettingsError, never> =>
  Effect.gen(function* () {
    let version = from
    while (version !== to) {
      const migration = migrations.find(
        (candidate) => candidate.from === version && candidate.to <= to
      )
      if (migration === undefined) {
        return yield* Effect.fail(
          new SettingsMigrationFailedError({
            schemaVersion: to,
            operation: "Settings.migrate",
            cause: Option.some(`missing migration from ${version} to ${to}`)
          })
        )
      }

      yield* migration.migrate(migrationContext(connection, namespace)).pipe(
        Effect.mapError(
          (error) =>
            new SettingsMigrationFailedError({
              schemaVersion: migration.to,
              operation: "Settings.migrate",
              cause: Option.some(error)
            })
        )
      )
      version = migration.to
    }
  })

const migrationContext = (
  connection: SqliteConnection,
  namespace: string
): SettingsMigrationContext => ({
  getRaw: (key) => readRaw(connection, namespace, key, "Settings.migration.getRaw"),
  setRaw: (key, value) =>
    writeRaw(connection, namespace, key, value, Date.now(), "Settings.migration.setRaw"),
  deleteRaw: (key) =>
    exec(
      connection,
      "DELETE FROM settings_values WHERE namespace = ? AND key = ?",
      [namespace, key],
      "Settings.migration.deleteRaw"
    ),
  rename: (from, to) =>
    Effect.gen(function* () {
      const current = yield* readRaw(connection, namespace, from, "Settings.migration.rename")
      if (Option.isSome(current)) {
        yield* writeRaw(
          connection,
          namespace,
          to,
          current.value,
          Date.now(),
          "Settings.migration.rename"
        )
        yield* exec(
          connection,
          "DELETE FROM settings_values WHERE namespace = ? AND key = ?",
          [namespace, from],
          "Settings.migration.rename"
        )
      }
    })
})

const readRaw = (
  connection: SqliteConnection,
  namespace: string,
  key: string,
  operation: string
): Effect.Effect<Option.Option<unknown>, SettingsError, never> =>
  Effect.gen(function* () {
    const rows = yield* query(
      connection,
      "SELECT value_json FROM settings_values WHERE namespace = ? AND key = ?",
      [namespace, key],
      operation
    )
    const row = rows[0]
    if (row === undefined) {
      return Option.none()
    }
    const json = row["value_json"]
    if (typeof json !== "string") {
      return yield* Effect.fail(
        new SettingsInvalidArgumentError({
          operation,
          field: "value_json",
          message: "stored setting is not JSON text",
          cause: Option.none()
        })
      )
    }

    return yield* Effect.try({
      try: () => Option.some(JSON.parse(json) as unknown),
      catch: (error) =>
        new SettingsInvalidArgumentError({
          operation,
          field: key,
          message: formatUnknownError(error),
          cause: Option.some(error)
        })
    })
  })

const writeRaw = (
  connection: SqliteConnection,
  namespace: string,
  key: string,
  value: unknown,
  updatedAtMs: number,
  operation: string
): Effect.Effect<void, SettingsError, never> =>
  Effect.gen(function* () {
    const json = yield* Effect.try({
      try: () => JSON.stringify(value),
      catch: (error) =>
        new SettingsInvalidArgumentError({
          operation,
          field: key,
          message: formatUnknownError(error),
          cause: Option.some(error)
        })
    })
    yield* exec(
      connection,
      "INSERT INTO settings_values (namespace, key, value_json, updated_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT(namespace, key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms",
      [namespace, key, json, updatedAtMs],
      operation
    )
  })

const query = (
  connection: SqliteConnection,
  sql: string,
  params: readonly SqliteValue[],
  operation: string
): Effect.Effect<readonly SqliteRow[], SettingsError, never> =>
  connection
    .query(sql, params)
    .pipe(Effect.mapError((error) => new SettingsSqliteError({ operation, cause: error })))

const exec = (
  connection: SqliteConnection,
  sql: string,
  params: readonly SqliteValue[],
  operation: string
): Effect.Effect<void, SettingsError, never> =>
  connection.exec(sql, params).pipe(
    Effect.asVoid,
    Effect.mapError((error) => new SettingsSqliteError({ operation, cause: error }))
  )

const recoverFromBackup = (
  sqlite: typeof SQLite.Service,
  connection: SqliteConnection,
  input: SettingsOpenInput,
  cause: SqliteCorruptError
): Effect.Effect<SqliteConnection, SettingsError, never> =>
  Effect.gen(function* () {
    const backupPath = input.backupPath
    if (backupPath === undefined) {
      return yield* Effect.fail(new SettingsSqliteError({ operation: "Settings.recover", cause }))
    }

    yield* connection.close()
    yield* Effect.tryPromise({
      try: () => copyFile(backupPath, input.path),
      catch: (error) =>
        new SettingsRecoveredFromBackupError({
          backupPath,
          operation: "Settings.recover",
          cause: Option.some(error)
        })
    })
    return yield* openConnection(sqlite, input, "Settings.recover")
  })

const decodeOpenInput = (
  input: unknown,
  operation: string
): Effect.Effect<SettingsOpenInput, SettingsInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(SettingsOpenInput)(input).pipe(
    Effect.mapError(
      (error) =>
        new SettingsInvalidArgumentError({
          operation,
          field: "payload",
          message: formatUnknownError(error),
          cause: Option.some(error)
        })
    )
  )

const decodeKey = (
  key: string,
  operation: string
): Effect.Effect<string, SettingsInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(NonEmptyString)(key).pipe(
    Effect.mapError(
      (error) =>
        new SettingsInvalidArgumentError({
          operation,
          field: "key",
          message: formatUnknownError(error),
          cause: Option.some(error)
        })
    )
  )

const encodeValue = <A>(
  schema: Schema.Schema<A>,
  value: A,
  key: string,
  operation: string
): Effect.Effect<unknown, SettingsInvalidArgumentError, never> =>
  (Schema.encodeUnknownEffect(schema)(value) as Effect.Effect<unknown, unknown, never>).pipe(
    Effect.mapError(
      (error) =>
        new SettingsInvalidArgumentError({
          operation,
          field: key,
          message: formatUnknownError(error),
          cause: Option.some(error)
        })
    )
  )

const decodeValue = <A>(
  schema: Schema.Schema<A>,
  value: unknown,
  key: string,
  operation: string
): Effect.Effect<A, SettingsInvalidArgumentError, never> =>
  (Schema.decodeUnknownEffect(schema)(value) as Effect.Effect<A, unknown, never>).pipe(
    Effect.mapError(
      (error) =>
        new SettingsInvalidArgumentError({
          operation,
          field: key,
          message: formatUnknownError(error),
          cause: Option.some(error)
        })
    )
  )

const publishChange = (
  pubsub: PubSub.PubSub<SettingsChange>,
  input: {
    readonly key: string
    readonly oldValue: unknown
    readonly newValue: unknown
    readonly source: string
  }
): Effect.Effect<void, never, never> =>
  PubSub.publish(
    pubsub,
    new SettingsChange({
      key: input.key,
      ...(input.oldValue === undefined ? {} : { oldValue: input.oldValue }),
      ...(input.newValue === undefined ? {} : { newValue: input.newValue }),
      source: input.source
    })
  ).pipe(Effect.asVoid)

const optionToOptional = (value: Option.Option<unknown>): unknown =>
  Option.isSome(value) ? value.value : undefined

const mapTransactionError = <E>(error: E | SettingsError | SqliteError): E | SettingsError => {
  if (isSettingsError(error)) {
    return error
  }

  if (isSqliteError(error)) {
    return new SettingsSqliteError({ operation: "Settings.transaction", cause: error })
  }

  return error
}

const isSettingsError = (error: unknown): error is SettingsError =>
  error instanceof SettingsInvalidArgumentError ||
  error instanceof SettingsSqliteError ||
  error instanceof SettingsMigrationFailedError ||
  error instanceof SettingsRecoveredFromBackupError

const isSqliteError = (error: unknown): error is SqliteError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  (error._tag === "Constraint" ||
    error._tag === "Busy" ||
    error._tag === "Locked" ||
    error._tag === "Corrupt" ||
    error._tag === "IoError" ||
    error._tag === "InvalidArgument" ||
    error._tag === "InvalidState")

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
