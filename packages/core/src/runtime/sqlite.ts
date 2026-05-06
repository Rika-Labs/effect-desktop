import {
  Database,
  type Changes,
  type DatabaseOptions,
  type SQLQueryBindings,
  type Statement
} from "bun:sqlite"

import { Context, Data, Effect, Exit, Layer, Option, Ref, Schema, Semaphore } from "effect"

import { ResourceRegistry, type ResourceHandle, type ResourceRegistryApi } from "./resources.js"

const NonEmptyString = Schema.NonEmptyString

export class SqliteConnectInput extends Schema.Class<SqliteConnectInput>("SqliteConnectInput")({
  path: NonEmptyString,
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
  readonly resource: ResourceHandle<"sqlite-statement", "open">
  readonly all: (params?: SqliteParams) => Effect.Effect<readonly SqliteRow[], SqliteError, never>
  readonly get: (
    params?: SqliteParams
  ) => Effect.Effect<Option.Option<SqliteRow>, SqliteError, never>
  readonly run: (params?: SqliteParams) => Effect.Effect<SqliteChanges, SqliteError, never>
  readonly dispose: () => Effect.Effect<void, never, never>
}

export interface SqliteConnection {
  readonly resource: ResourceHandle<"sqlite", "open">
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
  ) => Effect.Effect<SqliteConnection, SqliteError, never>
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

export const makeSQLite = (registry: ResourceRegistryApi): Effect.Effect<SqliteApi, never, never> =>
  Effect.sync(() =>
    Object.freeze({
      connect: (options: SqliteConnectOptions) =>
        Effect.gen(function* () {
          const input = yield* decodeConnectInput(options, "SQLite.connect")
          const database = yield* Effect.try({
            try: () => new Database(input.path, databaseOptions(input)),
            catch: (error) => mapSqliteError(error, input.path, "SQLite.connect")
          })
          const mutex = yield* Semaphore.make(1)
          const transactionOwner = yield* Ref.make<Option.Option<number>>(Option.none())
          const resource = yield* registry.register({
            kind: "sqlite",
            ownerScope: input.ownerScope,
            state: "open",
            dispose: closeDatabase(database, input.path)
          })

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
    return yield* makeSQLite(registry)
  })
)

const makeConnection = (
  database: Database,
  registry: ResourceRegistryApi,
  resource: ResourceHandle<"sqlite", "open">,
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
          const statementResource = yield* registry.register({
            kind: "sqlite-statement",
            ownerScope: resource.ownerScope,
            state: "open",
            dispose: finalizeStatement(statement, resource.id)
          })

          return makePreparedStatement(statement, statementResource, mutex, transactionOwner)
        })
      ),
    transaction: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
      options?: SqliteTransactionOptions
    ): Effect.Effect<A, E | SqliteError, R> =>
      mutex.withPermits(1)(
        Effect.gen(function* () {
          const owner = yield* Effect.fiberId
          yield* Ref.set(transactionOwner, Option.some(owner))
          yield* beginTransaction(database, resource, options?.mode ?? "deferred")
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
            attributes: { resource: resource.id, mode: options?.mode ?? "deferred" }
          })
        )
      ),
    close: () => resource.dispose()
  })

const makePreparedStatement = (
  statement: Statement,
  resource: ResourceHandle<"sqlite-statement", "open">,
  mutex: Semaphore.Semaphore,
  transactionOwner: Ref.Ref<Option.Option<number>>
): SqlitePreparedStatement =>
  Object.freeze({
    resource,
    all: (params?: SqliteParams) =>
      withStatement(resource, mutex, transactionOwner, "SQLite.PreparedStatement.all", () =>
        statement.all(...bindings(params)).map(row)
      ),
    get: (params?: SqliteParams) =>
      withStatement(resource, mutex, transactionOwner, "SQLite.PreparedStatement.get", () =>
        optionalRow(statement.get(...bindings(params)))
      ),
    run: (params?: SqliteParams) =>
      withStatement(resource, mutex, transactionOwner, "SQLite.PreparedStatement.run", () =>
        changes(statement.run(...bindings(params)))
      ),
    dispose: () => resource.dispose()
  })

const withConnection = <A>(
  resource: ResourceHandle<"sqlite", "open">,
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
  resource: ResourceHandle<"sqlite-statement", "open">,
  mutex: Semaphore.Semaphore,
  transactionOwner: Ref.Ref<Option.Option<number>>,
  operation: string,
  run: () => A
): Effect.Effect<A, SqliteError, never> =>
  Effect.gen(function* () {
    const owner = yield* Ref.get(transactionOwner)
    const effect = Effect.try({
      try: run,
      catch: (error) => mapSqliteError(error, resource.id, operation)
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
  Effect.try({
    try: () => {
      const statement = database.prepare(sql)
      try {
        return statement.all(...bindings(params)).map(row)
      } finally {
        statement.finalize()
      }
    },
    catch: (error) => mapSqliteError(error, sql, "SQLite.query")
  })

const runStatement = (
  database: Database,
  sql: string,
  params: SqliteParams | undefined
): Effect.Effect<SqliteChanges, SqliteError, never> =>
  Effect.try({
    try: () => {
      const statement = database.prepare(sql)
      try {
        return changes(statement.run(...bindings(params)))
      } finally {
        statement.finalize()
      }
    },
    catch: (error) => mapSqliteError(error, sql, "SQLite.exec")
  })

const beginTransaction = (
  database: Database,
  resource: ResourceHandle<"sqlite", "open">,
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
  resource: ResourceHandle<"sqlite", "open">
): Effect.Effect<void, SqliteError, never> =>
  Effect.try({
    try: () => {
      database.exec("COMMIT")
    },
    catch: (error) => mapSqliteError(error, resource.id, "SQLite.transaction.commit")
  })

const rollbackTransaction = (
  database: Database,
  resource: ResourceHandle<"sqlite", "open">
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

const databaseOptions = (input: SqliteConnectInput): DatabaseOptions => ({
  ...(input.readonly === undefined ? {} : { readonly: input.readonly }),
  ...(input.create === undefined ? {} : { create: input.create }),
  ...(input.readwrite === undefined ? {} : { readwrite: input.readwrite }),
  ...(input.safeIntegers === undefined ? {} : { safeIntegers: input.safeIntegers }),
  ...(input.strict === undefined ? {} : { strict: input.strict })
})

const bindings = (params: SqliteParams | undefined): SQLQueryBindings[] => {
  if (params === undefined) {
    return []
  }

  return Array.isArray(params) ? [...params] : [params as Record<string, SqliteValue>]
}

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

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
