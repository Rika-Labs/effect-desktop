import { Clock, Context, Data, Effect, Layer, Option, PubSub, Schema, Stream } from "effect"
import { KeyValueStore } from "effect/unstable/persistence"

import type { PermissionRegistry } from "./permission-registry.js"
import type { ResourceRegistry } from "./resources.js"
import { SqlClientLive, type SqlitePolicyError } from "./sqlite.js"

const NonEmptyString = Schema.NonEmptyString
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const SettingsMetadataText = Schema.NonEmptyString.check(
  // eslint-disable-next-line no-control-regex
  Schema.isPattern(/^[^\x00-\x1F\x7F]+$/)
)
const SettingsKeySchema = SettingsMetadataText

export class SettingsOpenInput extends Schema.Class<SettingsOpenInput>("SettingsOpenInput")({
  path: NonEmptyString,
  ownerScope: NonEmptyString,
  namespace: SettingsMetadataText,
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

export class SettingsKvError extends Data.TaggedError("KvError")<{
  readonly operation: string
  readonly cause: unknown
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
  | SettingsKvError
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

export interface SettingKey<A> {
  readonly name: string
  readonly schema: Schema.Schema<A>
  readonly defaultValue?: A
}

export const makeSettingKey = <A>(options: {
  readonly name: string
  readonly schema: Schema.Schema<A>
  readonly defaultValue?: A
}): SettingKey<A> => Object.freeze(options)

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
  readonly key: typeof makeSettingKey
  readonly get: <A>(
    key: string | SettingKey<A>,
    schema?: Schema.Schema<A>
  ) => Effect.Effect<Option.Option<A>, SettingsError, never>
  readonly getOrDefault: <A>(
    key: string | SettingKey<A>,
    schema?: Schema.Schema<A>,
    defaultValue?: A
  ) => Effect.Effect<A, SettingsError, never>
  readonly set: <A>(
    key: string | SettingKey<A>,
    schemaOrValue: Schema.Schema<A> | A,
    valueOrOptions?: A | SettingsMutationOptions,
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

const VERSION_KEY_SUFFIX = "__meta__/version"
const INDEX_KEY_SUFFIX = "__meta__/keys"

const versionKey = (namespace: string): string => `${namespace}/${VERSION_KEY_SUFFIX}`
const indexKey = (namespace: string): string => `${namespace}/${INDEX_KEY_SUFFIX}`
const valueKey = (namespace: string, key: string): string => `${namespace}/${key}`

const kvGet = (
  kv: KeyValueStore.KeyValueStore,
  storeKey: string,
  operation: string
): Effect.Effect<Option.Option<unknown>, SettingsError, never> =>
  kv.get(storeKey).pipe(
    Effect.mapError((cause) => new SettingsKvError({ operation, cause })),
    Effect.flatMap((raw) => {
      if (raw === undefined) {
        return Effect.succeed(Option.none())
      }
      return Effect.try({
        try: (): Option.Option<unknown> => {
          const parsed: unknown = JSON.parse(raw)
          return Option.some(parsed)
        },
        catch: (error) =>
          new SettingsInvalidArgumentError({
            operation,
            field: storeKey,
            message: formatUnknownError(error),
            cause: Option.some(error)
          })
      })
    })
  )

const kvSet = (
  kv: KeyValueStore.KeyValueStore,
  storeKey: string,
  value: unknown,
  operation: string
): Effect.Effect<void, SettingsError, never> =>
  encodeJsonText(value, storeKey, operation).pipe(
    Effect.flatMap((json) =>
      kv
        .set(storeKey, json)
        .pipe(Effect.mapError((cause) => new SettingsKvError({ operation, cause })))
    )
  )

const encodeJsonText = (
  value: unknown,
  field: string,
  operation: string
): Effect.Effect<string, SettingsInvalidArgumentError, never> =>
  Effect.try({
    try: () => JSON.stringify(value),
    catch: (error) =>
      new SettingsInvalidArgumentError({
        operation,
        field,
        message: formatUnknownError(error),
        cause: Option.some(error)
      })
  }).pipe(
    Effect.flatMap((json) =>
      typeof json === "string"
        ? Effect.succeed(json)
        : Effect.fail(
            new SettingsInvalidArgumentError({
              operation,
              field,
              message: "value is not JSON-serializable",
              cause: Option.none()
            })
          )
    )
  )

const kvRemove = (
  kv: KeyValueStore.KeyValueStore,
  storeKey: string,
  operation: string
): Effect.Effect<void, SettingsError, never> =>
  kv.remove(storeKey).pipe(Effect.mapError((cause) => new SettingsKvError({ operation, cause })))

const readIndex = (
  kv: KeyValueStore.KeyValueStore,
  namespace: string,
  operation: string
): Effect.Effect<readonly string[], SettingsError, never> =>
  kvGet(kv, indexKey(namespace), operation).pipe(
    Effect.flatMap((opt) => {
      if (Option.isNone(opt)) {
        return Effect.succeed([])
      }
      const raw = opt.value
      if (!Array.isArray(raw)) {
        return Effect.succeed([])
      }
      return Effect.succeed(raw.filter((k): k is string => typeof k === "string"))
    })
  )

const writeIndex = (
  kv: KeyValueStore.KeyValueStore,
  namespace: string,
  keys: readonly string[],
  operation: string
): Effect.Effect<void, SettingsError, never> => {
  const sorted = [...keys].sort()
  return kvSet(kv, indexKey(namespace), sorted, operation)
}

const addToIndex = (
  kv: KeyValueStore.KeyValueStore,
  namespace: string,
  key: string,
  operation: string
): Effect.Effect<void, SettingsError, never> =>
  readIndex(kv, namespace, operation).pipe(
    Effect.flatMap((existing) => {
      if (existing.includes(key)) {
        return Effect.void
      }
      return writeIndex(kv, namespace, [...existing, key], operation)
    })
  )

const removeFromIndex = (
  kv: KeyValueStore.KeyValueStore,
  namespace: string,
  key: string,
  operation: string
): Effect.Effect<void, SettingsError, never> =>
  readIndex(kv, namespace, operation).pipe(
    Effect.flatMap((existing) => {
      const next = existing.filter((k) => k !== key)
      if (next.length === existing.length) {
        return Effect.void
      }
      return writeIndex(kv, namespace, next, operation)
    })
  )

const readVersion = (
  kv: KeyValueStore.KeyValueStore,
  namespace: string,
  operation: string
): Effect.Effect<number | undefined, SettingsError, never> =>
  kvGet(kv, versionKey(namespace), operation).pipe(
    Effect.map((opt) => {
      if (Option.isNone(opt)) return undefined
      const val = opt.value
      return typeof val === "number" ? val : undefined
    })
  )

const writeVersion = (
  kv: KeyValueStore.KeyValueStore,
  namespace: string,
  version: number,
  operation: string
): Effect.Effect<void, SettingsError, never> => kvSet(kv, versionKey(namespace), version, operation)

export const makeSettings = (
  kv: KeyValueStore.KeyValueStore
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
          const migratedPub = yield* PubSub.sliding<SettingsMigrated>({
            capacity: 16,
            replay: 16
          })
          const now =
            options.now === undefined
              ? Clock.currentTimeMillis
              : Effect.sync(options.now).pipe(
                  Effect.catchDefect((error) =>
                    Effect.fail(
                      new SettingsMigrationFailedError({
                        schemaVersion: input.schemaVersion,
                        operation: "Settings.open",
                        cause: Option.some(error)
                      })
                    )
                  )
                )

          yield* initialize(kv, input, options.migrations ?? [], now, migratedPub)

          return makeStore(kv, input.namespace, changes, migratedPub)
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

export class Settings extends Context.Service<Settings, SettingsApi>()("Settings") {}

const SettingsFromKv: Layer.Layer<Settings, never, KeyValueStore.KeyValueStore> = Layer.effect(
  Settings,
  Effect.gen(function* () {
    const kv = yield* KeyValueStore.KeyValueStore
    return yield* makeSettings(kv)
  })
)

export const makeSettingsLayer = (
  path: string,
  ownerScope = "settings"
): Layer.Layer<Settings, SqlitePolicyError, PermissionRegistry | ResourceRegistry> =>
  SettingsFromKv.pipe(
    Layer.provide(KeyValueStore.layerSql()),
    Layer.provide(SqlClientLive({ filename: path, ownerScope }))
  )

export const makeSettingsLayerMemory: Layer.Layer<Settings, never, never> = SettingsFromKv.pipe(
  Layer.provide(KeyValueStore.layerMemory)
)

const makeStore = (
  kv: KeyValueStore.KeyValueStore,
  namespace: string,
  changes: PubSub.PubSub<SettingsChange>,
  migrations: PubSub.PubSub<SettingsMigrated>
): SettingsStore => {
  const get = <A>(
    key: string | SettingKey<A>,
    schema?: Schema.Schema<A>
  ): Effect.Effect<Option.Option<A>, SettingsError, never> =>
    Effect.gen(function* () {
      const resolved = yield* resolveSettingKey(key, schema, "Settings.get")
      const validatedKey = resolved.name
      const raw = yield* kvGet(kv, valueKey(namespace, validatedKey), "Settings.get")
      if (Option.isNone(raw)) {
        return Option.none()
      }

      return Option.some(
        yield* decodeValue(resolved.schema, raw.value, validatedKey, "Settings.get")
      )
    }).pipe(Effect.withSpan("Settings.get", { attributes: { namespace, key } }))

  return Object.freeze({
    key: makeSettingKey,
    get,
    getOrDefault: <A>(key: string | SettingKey<A>, schema?: Schema.Schema<A>, defaultValue?: A) =>
      Effect.gen(function* () {
        const resolved = yield* resolveSettingKey(key, schema, "Settings.getOrDefault")
        const value = yield* get(resolved)
        if (Option.isSome(value)) {
          return value.value
        }
        if (defaultValue !== undefined) {
          return defaultValue
        }
        if (resolved.defaultValue !== undefined) {
          return resolved.defaultValue
        }
        return yield* Effect.fail(
          new SettingsInvalidArgumentError({
            operation: "Settings.getOrDefault",
            field: resolved.name,
            message: "setting key has no default value",
            cause: Option.none()
          })
        )
      }),
    set: <A>(
      key: string | SettingKey<A>,
      schemaOrValue: Schema.Schema<A> | A,
      valueOrOptions?: A | SettingsMutationOptions,
      options?: SettingsMutationOptions
    ) =>
      Effect.gen(function* () {
        const resolved = yield* resolveSettingSetInput(
          key,
          schemaOrValue,
          valueOrOptions,
          options,
          "Settings.set"
        )
        const validatedKey = resolved.name
        const encoded = yield* encodeValue(
          resolved.schema,
          resolved.value,
          validatedKey,
          "Settings.set"
        )
        const oldRaw = yield* kvGet(kv, valueKey(namespace, validatedKey), "Settings.set")
        yield* kvSet(kv, valueKey(namespace, validatedKey), encoded, "Settings.set")
        yield* addToIndex(kv, namespace, validatedKey, "Settings.set")
        yield* publishChange(changes, {
          key: validatedKey,
          oldValue: optionToOptional(oldRaw),
          newValue: encoded,
          source: resolved.options?.source ?? "set"
        })
      }).pipe(Effect.withSpan("Settings.set", { attributes: { namespace, key } })),
    delete: (key: string, options?: SettingsMutationOptions) =>
      Effect.gen(function* () {
        const validatedKey = yield* decodeKey(key, "Settings.delete")
        const oldRaw = yield* kvGet(kv, valueKey(namespace, validatedKey), "Settings.delete")
        yield* kvRemove(kv, valueKey(namespace, validatedKey), "Settings.delete")
        yield* removeFromIndex(kv, namespace, validatedKey, "Settings.delete")
        if (Option.isSome(oldRaw)) {
          yield* publishChange(changes, {
            key: validatedKey,
            oldValue: oldRaw.value,
            newValue: undefined,
            source: options?.source ?? "delete"
          })
        }
      }).pipe(Effect.withSpan("Settings.delete", { attributes: { namespace, key } })),
    keys: () =>
      readIndex(kv, namespace, "Settings.keys").pipe(
        Effect.withSpan("Settings.keys", { attributes: { namespace } })
      ),
    update: <A, E, R>(
      key: string,
      schema: Schema.Schema<A>,
      updateFn: (current: Option.Option<A>) => Effect.Effect<A, E, R>,
      options?: SettingsMutationOptions
    ) =>
      Effect.gen(function* () {
        const validatedKey = yield* decodeKey(key, "Settings.update")
        const raw = yield* kvGet(kv, valueKey(namespace, validatedKey), "Settings.update")
        const current = Option.isSome(raw)
          ? Option.some(yield* decodeValue(schema, raw.value, validatedKey, "Settings.update"))
          : Option.none()
        const next = yield* updateFn(current)
        const encoded = yield* encodeValue(schema, next, validatedKey, "Settings.update")
        yield* kvSet(kv, valueKey(namespace, validatedKey), encoded, "Settings.update")
        yield* addToIndex(kv, namespace, validatedKey, "Settings.update")
        yield* publishChange(changes, {
          key: validatedKey,
          oldValue: optionToOptional(raw),
          newValue: encoded,
          source: options?.source ?? "update"
        })
        return next
      }).pipe(Effect.withSpan("Settings.update", { attributes: { namespace, key } })),
    changes: () => Stream.fromPubSub(changes),
    migrated: () => Stream.fromPubSub(migrations),
    close: () =>
      Effect.gen(function* () {
        yield* PubSub.shutdown(changes)
        yield* PubSub.shutdown(migrations)
      })
  })
}

const initialize = (
  kv: KeyValueStore.KeyValueStore,
  input: SettingsOpenInput,
  migrations: readonly SettingsMigration[],
  now: Effect.Effect<number, SettingsError, never>,
  migrated: PubSub.PubSub<SettingsMigrated>
): Effect.Effect<void, SettingsError, never> =>
  Effect.gen(function* () {
    const current = yield* readVersion(kv, input.namespace, "Settings.initialize")
    if (current === input.schemaVersion) {
      return
    }

    if (current === undefined) {
      yield* writeVersion(kv, input.namespace, input.schemaVersion, "Settings.initialize")
      return
    }

    const started = yield* now
    yield* runMigrations(kv, input.namespace, current, input.schemaVersion, migrations)
    const ended = yield* now
    const durationMs = yield* readMigrationDuration(started, ended, input.schemaVersion)
    yield* writeVersion(kv, input.namespace, input.schemaVersion, "Settings.initialize")
    yield* PubSub.publish(
      migrated,
      new SettingsMigrated({
        from: current,
        to: input.schemaVersion,
        durationMs
      })
    )
  })

const readMigrationDuration = (
  started: number,
  ended: number,
  schemaVersion: number
): Effect.Effect<number, SettingsMigrationFailedError, never> => {
  const durationMs = ended - started
  if (!Number.isFinite(durationMs)) {
    return Effect.fail(
      new SettingsMigrationFailedError({
        schemaVersion,
        operation: "Settings.migrate",
        cause: Option.some("migration duration must be finite")
      })
    )
  }

  return Effect.succeed(Math.max(0, durationMs))
}

const runMigrations = (
  kv: KeyValueStore.KeyValueStore,
  namespace: string,
  from: number,
  to: number,
  migrations: readonly SettingsMigration[]
): Effect.Effect<void, SettingsError, never> =>
  Effect.gen(function* () {
    let version = from
    while (version !== to) {
      const migration = migrations.find(
        (candidate) => candidate.from === version && candidate.to > version && candidate.to <= to
      )
      if (migration === undefined) {
        const nonAdvancing = migrations.find(
          (candidate) => candidate.from === version && candidate.to <= version
        )
        const cause =
          nonAdvancing === undefined
            ? `missing migration from ${version} to ${to}`
            : `non-advancing migration from ${version} to ${nonAdvancing.to}`
        return yield* Effect.fail(
          new SettingsMigrationFailedError({
            schemaVersion: to,
            operation: "Settings.migrate",
            cause: Option.some(cause)
          })
        )
      }

      yield* migration.migrate(migrationContext(kv, namespace)).pipe(
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
  kv: KeyValueStore.KeyValueStore,
  namespace: string
): SettingsMigrationContext => ({
  getRaw: (key) =>
    Effect.gen(function* () {
      const validatedKey = yield* decodeKey(key, "Settings.migration.getRaw")
      return yield* kvGet(kv, valueKey(namespace, validatedKey), "Settings.migration.getRaw")
    }),
  setRaw: (key, value) =>
    Effect.gen(function* () {
      const validatedKey = yield* decodeKey(key, "Settings.migration.setRaw")
      yield* kvSet(kv, valueKey(namespace, validatedKey), value, "Settings.migration.setRaw")
      yield* addToIndex(kv, namespace, validatedKey, "Settings.migration.setRaw")
    }),
  deleteRaw: (key) =>
    Effect.gen(function* () {
      const validatedKey = yield* decodeKey(key, "Settings.migration.deleteRaw")
      yield* kvRemove(kv, valueKey(namespace, validatedKey), "Settings.migration.deleteRaw")
      yield* removeFromIndex(kv, namespace, validatedKey, "Settings.migration.deleteRaw")
    }),
  rename: (from, to) =>
    Effect.gen(function* () {
      const validatedFrom = yield* decodeKey(from, "Settings.migration.rename.from")
      const validatedTo = yield* decodeKey(to, "Settings.migration.rename.to")
      const current = yield* kvGet(
        kv,
        valueKey(namespace, validatedFrom),
        "Settings.migration.rename"
      )
      if (Option.isSome(current)) {
        yield* kvSet(
          kv,
          valueKey(namespace, validatedTo),
          current.value,
          "Settings.migration.rename"
        )
        yield* addToIndex(kv, namespace, validatedTo, "Settings.migration.rename")
        yield* kvRemove(kv, valueKey(namespace, validatedFrom), "Settings.migration.rename")
        yield* removeFromIndex(kv, namespace, validatedFrom, "Settings.migration.rename")
      }
    })
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
  Schema.decodeUnknownEffect(SettingsKeySchema)(key).pipe(
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

const isSettingKey = <A>(value: string | SettingKey<A>): value is SettingKey<A> =>
  typeof value === "object" && value !== null && "name" in value && "schema" in value

const resolveSettingKey = <A>(
  key: string | SettingKey<A>,
  schema: Schema.Schema<A> | undefined,
  operation: string
): Effect.Effect<SettingKey<A>, SettingsInvalidArgumentError, never> =>
  Effect.gen(function* () {
    if (isSettingKey(key)) {
      const name = yield* decodeKey(key.name, operation)
      return { ...key, name }
    }
    if (schema === undefined) {
      return yield* Effect.fail(
        new SettingsInvalidArgumentError({
          operation,
          field: key,
          message: "schema is required when using a raw setting key",
          cause: Option.none()
        })
      )
    }
    return {
      name: yield* decodeKey(key, operation),
      schema
    }
  })

const resolveSettingSetInput = <A>(
  key: string | SettingKey<A>,
  schemaOrValue: Schema.Schema<A> | A,
  valueOrOptions: A | SettingsMutationOptions | undefined,
  options: SettingsMutationOptions | undefined,
  operation: string
): Effect.Effect<
  SettingKey<A> & {
    readonly value: A
    readonly options: SettingsMutationOptions | undefined
  },
  SettingsInvalidArgumentError,
  never
> =>
  Effect.gen(function* () {
    if (isSettingKey(key)) {
      const resolved = yield* resolveSettingKey(key, undefined, operation)
      return {
        ...resolved,
        value: schemaOrValue as A,
        options: valueOrOptions as SettingsMutationOptions | undefined
      }
    }
    const resolved = yield* resolveSettingKey(key, schemaOrValue as Schema.Schema<A>, operation)
    return {
      ...resolved,
      value: valueOrOptions as A,
      options
    }
  })

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

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
