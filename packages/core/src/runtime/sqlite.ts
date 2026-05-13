import { realpath } from "node:fs/promises"
import { dirname, join } from "node:path"

import * as UpstreamSqliteClient from "@effect/sql-sqlite-bun/SqliteClient"
import { Data, Effect, Exit, Layer, Option, Schema, Scope } from "effect"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { SqlError } from "effect/unstable/sql/SqlError"
import * as SqlModel from "effect/unstable/sql/SqlModel"

import {
  PermissionActor,
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError
} from "./permission-registry.js"
import { ResourceRegistry } from "./resources.js"

export { SqlClient, SqlError, SqlModel }
export { UpstreamSqliteClient as SqliteClient }
export type { SqliteClientConfig } from "@effect/sql-sqlite-bun/SqliteClient"

const NonEmptyString = Schema.NonEmptyString
// eslint-disable-next-line no-control-regex -- SQLite paths cannot contain NUL bytes.
const SqlitePathString = NonEmptyString.check(Schema.isPattern(/^[^\u0000]+$/))

export interface SqlClientLayerConfig extends Omit<
  UpstreamSqliteClient.SqliteClientConfig,
  "filename"
> {
  readonly filename: string
  readonly ownerScope: string
}

export class SqliteInvalidArgumentError extends Data.TaggedError("InvalidArgument")<{
  readonly operation: string
  readonly field: "filename" | "ownerScope"
  readonly message: string
  readonly cause: Option.Option<unknown>
}> {}

export type SqlitePolicyError = SqliteInvalidArgumentError | PermissionRegistryError

export const SqlClientLive = (
  config: SqlClientLayerConfig
): Layer.Layer<
  SqlClient | UpstreamSqliteClient.SqliteClient,
  SqlitePolicyError,
  ResourceRegistry | PermissionRegistry
> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const registry = yield* ResourceRegistry
      const permissions = yield* PermissionRegistry
      const input = yield* decodeSqlClientLayerConfig(config)
      const filename = yield* authorizeSqliteFilename(input, permissions)
      const sqlScope = yield* Scope.make("sequential")
      yield* Effect.addFinalizer(() => Scope.close(sqlScope, Exit.void).pipe(Effect.ignore))

      const context = yield* Layer.buildWithScope(
        UpstreamSqliteClient.layer({
          ...config,
          filename
        }),
        sqlScope
      )

      const handle = yield* registry
        .register({
          kind: "sqlite",
          ownerScope: input.ownerScope,
          state: "open",
          dispose: Scope.close(sqlScope, Exit.void).pipe(Effect.ignore)
        })
        .pipe(Effect.orDie)

      yield* Effect.addFinalizer(() => handle.dispose())

      return context
    })
  )

const decodeSqlClientLayerConfig = (
  config: SqlClientLayerConfig
): Effect.Effect<SqlClientLayerConfig, SqliteInvalidArgumentError, never> =>
  Effect.gen(function* () {
    const filename = yield* decodeStringField(config.filename, "filename", "SqlClientLive")
    const ownerScope = yield* decodeStringField(config.ownerScope, "ownerScope", "SqlClientLive")
    return { ...config, filename, ownerScope }
  })

const decodeStringField = (
  value: unknown,
  field: "filename" | "ownerScope",
  operation: string
): Effect.Effect<string, SqliteInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(field === "filename" ? SqlitePathString : NonEmptyString)(value).pipe(
    Effect.mapError(
      (error) =>
        new SqliteInvalidArgumentError({
          operation,
          field,
          message: formatUnknownError(error),
          cause: Option.some(error)
        })
    )
  )

const authorizeSqliteFilename = (
  input: SqlClientLayerConfig,
  permissions: PermissionRegistryApi
): Effect.Effect<string, SqliteInvalidArgumentError | PermissionRegistryError, never> =>
  Effect.gen(function* () {
    if (input.filename === ":memory:") {
      return input.filename
    }

    const canonicalPath = yield* canonicalizeSqlitePath(input.filename)
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
      { source: "SqlClientLive" }
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
    field: "filename",
    operation: "SqlClientLive",
    message: formatUnknownError(cause),
    cause: Option.some({ path, cause })
  })

const isNodeError = (error: unknown): error is Error & { readonly code: string } =>
  error instanceof Error && "code" in error && typeof error.code === "string"

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
