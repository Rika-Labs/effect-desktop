import {
  Database,
  type Changes,
  type DatabaseOptions,
  type SQLQueryBindings,
  type Statement
} from "bun:sqlite"
import { realpath } from "node:fs/promises"
import { dirname, join } from "node:path"

import { Context, Data, Effect, Exit, Layer, Option, Ref, Schema, Semaphore } from "effect"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { SqlError } from "effect/unstable/sql/SqlError"
import * as SqlModel from "effect/unstable/sql/SqlModel"
import * as UpstreamSqliteClient from "@effect/sql-sqlite-bun/SqliteClient"

import {
  ResourceRegistry,
  type ManagedResourceHandle,
  type ResourceRegistryApi
} from "./resources.js"
import {
  PermissionActor,
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError
} from "./permission-registry.js"

export { SqlClient, SqlError, SqlModel }
export { UpstreamSqliteClient as SqliteClient }
export type { SqliteClientConfig } from "@effect/sql-sqlite-bun/SqliteClient"

const NonEmptyString = Schema.NonEmptyString
// eslint-disable-next-line no-control-regex -- SQLite paths cannot contain NUL bytes.
const SqlitePathString = NonEmptyString.check(Schema.isPattern(/^[^\u0000]+$/))

export interface SqlClientLayerConfig {
  readonly filename: string
  readonly ownerScope: string
  readonly readonly?: boolean | undefined
  readonly create?: boolean | undefined
  readonly readwrite?: boolean | undefined
  readonly disableWAL?: boolean | undefined
}

export const SqlClientLive = (
  config: SqlClientLayerConfig
): Layer.Layer<SqlClient, never, ResourceRegistry> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* ResourceRegistry
      yield* registry
        .register({
          kind: "sqlite",
          ownerScope: config.ownerScope,
          state: "open"
        })
        .pipe(Effect.orDie)
    })
  ).pipe(
    Layer.provideMerge(
      UpstreamSqliteClient.layer({
        filename: config.filename,
        readonly: config.readonly,
        create: config.create,
        readwrite: config.readwrite,
        disableWAL: config.disableWAL
      })
    )
  )

export class SqliteConnectInput extends Schema.Class<SqliteConnectInput>("SqliteConnectInput")({
  path: SqlitePathString,
  ownerScope: NonEmptyString,
  readonly: Schema.optionalKey(Schema.Boolean),
  create: Schema.optionalKey(Schema.Boolean),
  readwrite: Schema.optionalKey(Schema.Boolean),
  safeIntegers: Schema.optionalKey(Schema.Boolean),
  strict: Schema.optionalKey(Schema.Boolean)
}) {}

export type SqliteValue = string | bigint | number | boolean | Uint8Array | null
export type SqliteParams = readonly SqliteValue[] | Readonly<Record<string, SqliteValue>>
export type SqliteRow = Readonly<Record<string, SqliteValue>>

export interface SqliteChanges {
  readonly changes: number
  readonly lastInsertRowid: number | bigint
}

export interface SqliteConnectOptions extends DatabaseOptions {
  readonly path: string
  readonly ownerScope: string
}

export interface SqlitePreparedStatement {
  readonly resource: ManagedResourceHandle<"sqlite-statement", "open">
  readonly all: (params?: SqliteParams) => Effect.Effect<readonly SqliteRow[], SqliteError, never>
  readonly get: (
    params?: SqliteParams
  ) => Effect.Effect<Option.Option<SqliteRow>, SqliteError, never>
  readonly run: (params?: SqliteParams) => Effect.Effect<SqliteChanges, SqliteError, never>
  readonly dispose: () => Effect.Effect<void, never, never>
}

export interface SqliteConnection {
  readonly resource: ManagedResourceHandle<"sqlite", "open">
  readonly query: (
    sql: string,
    params?: SqliteParams
  ) => Effect.Effect<readonly SqliteRow[], SqliteError, never>
  readonly exec: (
    sql: string,
    params?: SqliteParams
  ) => Effect.Effect<SqliteChanges, SqliteError, never>
  readonly prepare: (sql: string) => Effect.Effect<SqlitePreparedStatement, SqliteError, never>
  readonly transaction: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: SqliteTransactionOptions
  ) => Effect.Effect<A, E | SqliteError, R>
  readonly close: () => Effect.Effect<void, never, never>
}

export interface SqliteTransactionOptions {
  readonly mode?: SqliteTransactionMode
}

export type SqliteTransactionMode = "deferred" | "immediate" | "exclusive"

export interface SqliteApi {
  readonly connect: (
    options: SqliteConnectOptions
  ) => Effect.Effect<SqliteConnection, SqliteError | PermissionRegistryError, never>
}

export class SqliteConstraintError extends Data.TaggedError("Constraint")<SqliteErrorFields> {}
export class SqliteBusyError extends Data.TaggedError("Busy")<SqliteErrorFields> {}
export class SqliteLockedError extends Data.TaggedError("Locked")<SqliteErrorFields> {}
export class SqliteCorruptError extends Data.TaggedError("Corrupt")<SqliteErrorFields> {}
export class SqliteIoError extends Data.TaggedError("IoError")<SqliteErrorFields> {}
export class SqliteInvalidArgumentError extends Data.TaggedError("InvalidArgument")<
  SqliteErrorFields & { readonly field: string }
> {}
export class SqliteInvalidStateError extends Data.TaggedError("InvalidState")<SqliteErrorFields> {}

export type SqliteError =
  | SqliteConstraintError
  | SqliteBusyError
  | SqliteLockedError
  | SqliteCorruptError
  | SqliteIoError
  | SqliteInvalidArgumentError
  | SqliteInvalidStateError

export interface SqliteErrorFields {
  readonly operation: string
  readonly resource: string
  readonly message: string
  readonly code: Option.Option<string>
  readonly cause: Option.Option<unknown>
}

export interface SQLiteOptions {
  readonly permissions?: PermissionRegistryApi
}

export const makeSQLite = (
  registry: ResourceRegistryApi,
  serviceOptions: SQLiteOptions = {}
): Effect.Effect<SqliteApi, never, never> =>
  Effect.sync(() =>
    Object.freeze({
      connect: (options: SqliteConnectOptions) =>
        Effect.gen(function* () {
          const input = yield* decodeConnectInput(options, "SQLite.connect")
          const authorizedPath = yield* authorizeSQLitePath(input, serviceOptions.permissions)
          const database = yield* Effect.try({
            try: () => new Database(authorizedPath, databaseOptions(input)),
            catch: (error) => mapSqliteError(error, authorizedPath, "SQLite.connect")
          })
          const mutex = yield* Semaphore.make(1)
          const transactionOwner = yield* Ref.make<Option.Option<number>>(Option.none())
          const resource = yield* registry
            .register({
              kind: "sqlite",
              ownerScope: input.ownerScope,
              state: "open",
              dispose: closeDatabase(database, authorizedPath)
            })
            .pipe(Effect.orDie)

          return makeConnection(database, registry, resource, mutex, transactionOwner)
        }).pipe(
          Effect.withSpan("SQLite.connect", {
            attributes: { path: options.path, ownerScope: options.ownerScope }
          })
        )
    })
  )

export class SQLite extends Context.Service<SQLite, SqliteApi>()("SQLite") {}

export const SQLiteLive = Layer.effect(
  SQLite,
  Effect.gen(function* () {
    const registry = yield* ResourceRegistry
    const permissions = yield* PermissionRegistry
    return yield* makeSQLite(registry, { permissions })
  })
)

const makeConnection = (
  database: Database,
  registry: ResourceRegistryApi,
  resource: ManagedResourceHandle<"sqlite", "open">,
  mutex: Semaphore.Semaphore,
  transactionOwner: Ref.Ref<Option.Option<number>>
): SqliteConnection =>
  Object.freeze({
    resource,
    query: (sql: string, params?: SqliteParams) =>
      withConnection(
        resource,
        mutex,
        transactionOwner,
        "SQLite.query",
        sql,
        queryRows(database, sql, params)
      ),
    exec: (sql: string, params?: SqliteParams) =>
      withConnection(
        resource,
        mutex,
        transactionOwner,
        "SQLite.exec",
        sql,
        runStatement(database, sql, params)
      ),
    prepare: (sql: string) =>
      withConnection(
        resource,
        mutex,
        transactionOwner,
        "SQLite.prepare",
        sql,
        Effect.gen(function* () {
          const statement = yield* Effect.try({
            try: () => database.prepare(sql),
            catch: (error) => mapSqliteError(error, resource.id, "SQLite.prepare")
          })
          const statementResource = yield* registry
            .register({
              kind: "sqlite-statement",
              ownerScope: resource.ownerScope,
              state: "open",
              dispose: finalizeStatement(statement, resource.id)
            })
            .pipe(Effect.orDie)

          return makePreparedStatement(statement, statementResource, mutex, transactionOwner)
        })
      ),
    transaction: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
      options?: SqliteTransactionOptions
    ): Effect.Effect<A, E | SqliteError, R> =>
      Effect.flatMap(
        decodeTransactionMode(options, resource.id, "SQLite.transaction"),
        (mode): Effect.Effect<A, E | SqliteError, R> =>
          mutex.withPermits(1)(
            Effect.gen(function* () {
              const owner = yield* Effect.fiberId
              yield* Ref.set(transactionOwner, Option.some(owner))
              yield* beginTransaction(database, resource, mode)
              const exit = yield* Effect.exit(effect)
              yield* Ref.set(transactionOwner, Option.none())
              if (Exit.isSuccess(exit)) {
                yield* commitTransaction(database, resource)
                return exit.value
              }

              yield* rollbackTransaction(database, resource)
              return yield* Effect.failCause(exit.cause)
            }).pipe(
              Effect.onExit(() => Ref.set(transactionOwner, Option.none())),
              Effect.withSpan("SQLite.transaction", {
                attributes: { resource: resource.id, mode }
              })
            )
          )
      ),
    close: () => resource.dispose()
  })

const makePreparedStatement = (
  statement: Statement,
  resource: ManagedResourceHandle<"sqlite-statement", "open">,
  mutex: Semaphore.Semaphore,
  transactionOwner: Ref.Ref<Option.Option<number>>
): SqlitePreparedStatement =>
  Object.freeze({
    resource,
    all: (params?: SqliteParams) =>
      withStatement(
        resource,
        mutex,
        transactionOwner,
        "SQLite.PreparedStatement.all",
        params,
        (b) => statement.all(...b).map(row)
      ),
    get: (params?: SqliteParams) =>
      withStatement(
        resource,
        mutex,
        transactionOwner,
        "SQLite.PreparedStatement.get",
        params,
        (b) => optionalRow(statement.get(...b))
      ),
    run: (params?: SqliteParams) =>
      withStatement(
        resource,
        mutex,
        transactionOwner,
        "SQLite.PreparedStatement.run",
        params,
        (b) => changes(statement.run(...b))
      ),
    dispose: () => resource.dispose()
  })

const withConnection = <A>(
  resource: ManagedResourceHandle<"sqlite", "open">,
  mutex: Semaphore.Semaphore,
  transactionOwner: Ref.Ref<Option.Option<number>>,
  operation: string,
  sql: string,
  effect: Effect.Effect<A, SqliteError, never>
): Effect.Effect<A, SqliteError, never> =>
  Effect.gen(function* () {
    const owner = yield* Ref.get(transactionOwner)
    const traced = effect.pipe(
      Effect.withSpan(operation, { attributes: { resource: resource.id, sql } })
    )

    const ownsTransaction = yield* isTransactionOwner(owner)
    return yield* ownsTransaction ? traced : mutex.withPermits(1)(traced)
  })

const withStatement = <A>(
  resource: ManagedResourceHandle<"sqlite-statement", "open">,
  mutex: Semaphore.Semaphore,
  transactionOwner: Ref.Ref<Option.Option<number>>,
  operation: string,
  params: SqliteParams | undefined,
  run: (bindings: SQLQueryBindings[]) => A
): Effect.Effect<A, SqliteError, never> =>
  Effect.gen(function* () {
    const owner = yield* Ref.get(transactionOwner)
    const effect = Effect.gen(function* () {
      const validated = yield* bindings(params, resource.id, operation)
      return yield* Effect.try({
        try: () => run(validated),
        catch: (error) => mapSqliteError(error, resource.id, operation)
      })
    }).pipe(Effect.withSpan(operation, { attributes: { resource: resource.id } }))

    const ownsTransaction = yield* isTransactionOwner(owner)
    return yield* ownsTransaction ? effect : mutex.withPermits(1)(effect)
  })

const isTransactionOwner = (owner: Option.Option<number>): Effect.Effect<boolean, never, never> =>
  Effect.gen(function* () {
    if (Option.isNone(owner)) {
      return false
    }

    const current = yield* Effect.fiberId
    return owner.value === current
  })

const queryRows = (
  database: Database,
  sql: string,
  params: SqliteParams | undefined
): Effect.Effect<readonly SqliteRow[], SqliteError, never> =>
  Effect.gen(function* () {
    const validated = yield* bindings(params, sql, "SQLite.query")
    return yield* Effect.try({
      try: () => {
        const statement = database.prepare(sql)
        try {
          return statement.all(...validated).map(row)
        } finally {
          statement.finalize()
        }
      },
      catch: (error) => mapSqliteError(error, sql, "SQLite.query")
    })
  })

const runStatement = (
  database: Database,
  sql: string,
  params: SqliteParams | undefined
): Effect.Effect<SqliteChanges, SqliteError, never> =>
  Effect.gen(function* () {
    const validated = yield* bindings(params, sql, "SQLite.exec")
    return yield* Effect.try({
      try: () => {
        const statement = database.prepare(sql)
        try {
          return changes(statement.run(...validated))
        } finally {
          statement.finalize()
        }
      },
      catch: (error) => mapSqliteError(error, sql, "SQLite.exec")
    })
  })

const beginTransaction = (
  database: Database,
  resource: ManagedResourceHandle<"sqlite", "open">,
  mode: SqliteTransactionMode
): Effect.Effect<void, SqliteError, never> =>
  Effect.try({
    try: () => {
      database.exec(mode === "deferred" ? "BEGIN" : `BEGIN ${mode.toUpperCase()}`)
    },
    catch: (error) => mapSqliteError(error, resource.id, "SQLite.transaction.begin")
  })

const commitTransaction = (
  database: Database,
  resource: ManagedResourceHandle<"sqlite", "open">
): Effect.Effect<void, SqliteError, never> =>
  Effect.try({
    try: () => {
      database.exec("COMMIT")
    },
    catch: (error) => mapSqliteError(error, resource.id, "SQLite.transaction.commit")
  })

const rollbackTransaction = (
  database: Database,
  resource: ManagedResourceHandle<"sqlite", "open">
): Effect.Effect<void, SqliteError, never> =>
  Effect.try({
    try: () => {
      database.exec("ROLLBACK")
    },
    catch: (error) => mapSqliteError(error, resource.id, "SQLite.transaction.rollback")
  })

const decodeConnectInput = (
  input: unknown,
  operation: string
): Effect.Effect<SqliteConnectInput, SqliteInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(SqliteConnectInput)(input).pipe(
    Effect.mapError(
      (error) =>
        new SqliteInvalidArgumentError({
          field: "payload",
          operation,
          resource: "sqlite",
          message: formatUnknownError(error),
          code: Option.none(),
          cause: Option.some(error)
        })
    )
  )

const authorizeSQLitePath = (
  input: SqliteConnectInput,
  permissions: PermissionRegistryApi | undefined
): Effect.Effect<string, SqliteInvalidArgumentError | PermissionRegistryError, never> =>
  Effect.gen(function* () {
    if (input.path === ":memory:") {
      return input.path
    }

    const canonicalPath = yield* canonicalizeSqlitePath(input.path)
    if (permissions === undefined) {
      return canonicalPath
    }

    yield* permissions.check(
      {
        kind: "sqlite.open",
        roots: [canonicalPath],
        audit: "always"
      },
      {
        actor: new PermissionActor({ kind: "resource", id: input.ownerScope }),
        resource: canonicalPath
      },
      { source: "SQLite.connect" }
    )

    return canonicalPath
  })

const canonicalizeSqlitePath = (
  path: string
): Effect.Effect<string, SqliteInvalidArgumentError, never> =>
  Effect.tryPromise({
    try: () => realpath(path),
    catch: (error) => error
  }).pipe(
    Effect.catch((error) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        const parent = dirname(path)
        if (parent === path) {
          return Effect.fail(makeSqliteInvalidPath(path, error))
        }
        return canonicalizeSqliteParent(parent).pipe(
          Effect.map((canonicalParent) => join(canonicalParent, pathSegment(path)))
        )
      }
      return Effect.fail(makeSqliteInvalidPath(path, error))
    })
  )

const canonicalizeSqliteParent = (
  path: string
): Effect.Effect<string, SqliteInvalidArgumentError, never> =>
  Effect.tryPromise({
    try: () => realpath(path),
    catch: (error) => error
  }).pipe(
    Effect.catch((error) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        const parent = dirname(path)
        if (parent === path) {
          return Effect.fail(makeSqliteInvalidPath(path, error))
        }
        return canonicalizeSqliteParent(parent).pipe(
          Effect.map((canonicalParent) => join(canonicalParent, pathSegment(path)))
        )
      }
      return Effect.fail(makeSqliteInvalidPath(path, error))
    })
  )

const pathSegment = (path: string): string => {
  const normalized = path.replaceAll("\\", "/")
  return normalized.slice(normalized.lastIndexOf("/") + 1)
}

const makeSqliteInvalidPath = (path: string, cause: unknown): SqliteInvalidArgumentError =>
  new SqliteInvalidArgumentError({
    field: "path",
    operation: "SQLite.connect",
    resource: path,
    message: formatUnknownError(cause),
    code: Option.none(),
    cause: Option.some(cause)
  })

const databaseOptions = (input: SqliteConnectInput): DatabaseOptions => ({
  ...(input.readonly === undefined ? {} : { readonly: input.readonly }),
  ...(input.create === undefined ? {} : { create: input.create }),
  ...(input.readwrite === undefined ? {} : { readwrite: input.readwrite }),
  ...(input.safeIntegers === undefined ? {} : { safeIntegers: input.safeIntegers }),
  ...(input.strict === undefined ? {} : { strict: input.strict })
})

const decodeTransactionMode = (
  options: SqliteTransactionOptions | undefined,
  resource: string,
  operation: string
): Effect.Effect<SqliteTransactionMode, SqliteInvalidArgumentError, never> => {
  const mode = options?.mode ?? "deferred"
  if (mode === "deferred" || mode === "immediate" || mode === "exclusive") {
    return Effect.succeed(mode)
  }

  return Effect.fail(
    new SqliteInvalidArgumentError({
      field: "mode",
      operation,
      resource,
      message: `unsupported transaction mode: ${String(mode)}`,
      code: Option.none(),
      cause: Option.none()
    })
  )
}

const bindings = (
  params: SqliteParams | undefined,
  resource: string,
  operation: string
): Effect.Effect<SQLQueryBindings[], SqliteInvalidArgumentError, never> => {
  if (params === undefined) {
    return Effect.succeed([])
  }

  if (Array.isArray(params)) {
    for (const [index, value] of params.entries()) {
      if (!isSqliteValue(value)) {
        return Effect.fail(invalidBinding(resource, operation, `params[${index}]`, value))
      }
    }
    return Effect.succeed([...params])
  }

  if (typeof params !== "object" || params === null || params instanceof Uint8Array) {
    return Effect.fail(invalidBinding(resource, operation, "params", params))
  }

  for (const [key, value] of Object.entries(params)) {
    if (!isSqliteValue(value)) {
      return Effect.fail(invalidBinding(resource, operation, `params.${key}`, value))
    }
  }

  return Effect.succeed([params as Record<string, SqliteValue>])
}

const isSqliteValue = (value: unknown): value is SqliteValue =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "bigint" ||
  typeof value === "boolean" ||
  value instanceof Uint8Array

const invalidBinding = (
  resource: string,
  operation: string,
  field: string,
  value: unknown
): SqliteInvalidArgumentError =>
  new SqliteInvalidArgumentError({
    field,
    operation,
    resource,
    message: `unsupported SQLite bind value: ${formatValueType(value)}`,
    code: Option.none(),
    cause: Option.some(value)
  })

const formatValueType = (value: unknown): string =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value

const row = (value: unknown): SqliteRow => value as SqliteRow

const optionalRow = (value: unknown): Option.Option<SqliteRow> =>
  value === null || value === undefined ? Option.none() : Option.some(row(value))

const changes = (value: Changes): SqliteChanges => ({
  changes: value.changes,
  lastInsertRowid: value.lastInsertRowid
})

const closeDatabase = (database: Database, path: string): Effect.Effect<void, never, never> =>
  Effect.sync(() => {
    try {
      database.close()
    } catch (error) {
      Effect.runSync(
        Effect.logWarning("SQLite.close failed", {
          path,
          reason: formatUnknownError(error)
        })
      )
    }
  })

const finalizeStatement = (
  statement: Statement,
  resource: string
): Effect.Effect<void, never, never> =>
  Effect.sync(() => {
    try {
      statement.finalize()
    } catch (error) {
      Effect.runSync(
        Effect.logWarning("SQLite.statement.finalize failed", {
          resource,
          reason: formatUnknownError(error)
        })
      )
    }
  })

const mapSqliteError = (error: unknown, resource: string, operation: string): SqliteError => {
  if (isSqliteError(error)) {
    const common = sqliteErrorFields(error, resource, operation)
    const code = error.code ?? ""

    if (code.startsWith("SQLITE_CONSTRAINT")) {
      return new SqliteConstraintError(common)
    }
    if (code.startsWith("SQLITE_BUSY")) {
      return new SqliteBusyError(common)
    }
    if (code.startsWith("SQLITE_LOCKED")) {
      return new SqliteLockedError(common)
    }
    if (code.startsWith("SQLITE_CORRUPT") || code.startsWith("SQLITE_NOTADB")) {
      return new SqliteCorruptError(common)
    }
    if (code.startsWith("SQLITE_IOERR")) {
      return new SqliteIoError(common)
    }

    return new SqliteInvalidStateError(common)
  }

  return new SqliteInvalidStateError({
    operation,
    resource,
    message: formatUnknownError(error),
    code: Option.none(),
    cause: Option.some(error)
  })
}

const sqliteErrorFields = (error: SqliteDriverError, resource: string, operation: string) => ({
  operation,
  resource,
  message: error.message,
  code: error.code === undefined ? Option.none() : Option.some(error.code),
  cause: Option.some(error)
})

interface SqliteDriverError extends Error {
  readonly name: "SQLiteError"
  readonly code?: string
}

const isSqliteError = (error: unknown): error is SqliteDriverError =>
  error instanceof Error && error.name === "SQLiteError"

const isNodeError = (error: unknown): error is Error & { readonly code: string } =>
  error instanceof Error && "code" in error && typeof error.code === "string"

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
