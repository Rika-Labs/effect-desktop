import * as UpstreamSqliteClient from "@effect/sql-sqlite-bun/SqliteClient"
import { Data, Effect, Exit, Layer, Option, Schema, Scope } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { SqlError } from "effect/unstable/sql/SqlError"
import * as SqlModel from "effect/unstable/sql/SqlModel"

import {
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError
} from "./permission-registry.js"
import { ResourceOwner, type ResourceOwnerApi } from "./resource-owner.js"
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
}

export class SqliteInvalidArgumentError extends Data.TaggedError("InvalidArgument")<{
  readonly operation: string
  readonly field: "filename"
  readonly message: string
  readonly cause: Option.Option<unknown>
}> {}

export type SqlitePolicyError = SqliteInvalidArgumentError | PermissionRegistryError

export const SqlClientLive = (
  config: SqlClientLayerConfig
): Layer.Layer<
  SqlClient | UpstreamSqliteClient.SqliteClient,
  SqlitePolicyError,
  ResourceOwner | ResourceRegistry | PermissionRegistry | FileSystem | Path
> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const owner = yield* ResourceOwner
      const registry = yield* ResourceRegistry
      const permissions = yield* PermissionRegistry
      const fs = yield* FileSystem
      const path = yield* Path
      const input = yield* decodeSqlClientLayerConfig(config)
      const filename = yield* authorizeSqliteFilename(input, owner, permissions, fs, path)
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
          ownerScope: owner.scopeId,
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
    return { ...config, filename }
  })

const decodeStringField = (
  value: unknown,
  field: "filename",
  operation: string
): Effect.Effect<string, SqliteInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(SqlitePathString)(value).pipe(
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
  owner: ResourceOwnerApi,
  permissions: PermissionRegistryApi,
  fs: FileSystem,
  path: Path
): Effect.Effect<string, SqliteInvalidArgumentError | PermissionRegistryError, never> =>
  Effect.gen(function* () {
    if (input.filename === ":memory:") {
      return input.filename
    }

    const canonicalPath = yield* canonicalizeSqlitePath(input.filename, fs, path)
    yield* permissions.check(
      {
        kind: "sqlite.open",
        roots: [canonicalPath],
        audit: "always"
      },
      {
        actor: owner.actor,
        resource: canonicalPath
      },
      { source: "SqlClientLive" }
    )

    return canonicalPath
  })

const canonicalizeSqlitePath = (
  target: string,
  fs: FileSystem,
  path: Path
): Effect.Effect<string, SqliteInvalidArgumentError, never> =>
  fs.realPath(target).pipe(
    Effect.catch((error) => {
      if (error.reason._tag === "NotFound") {
        const parent = path.dirname(target)
        if (parent === target) {
          return Effect.fail(makeSqliteInvalidPath(target, error))
        }
        return canonicalizeSqlitePath(parent, fs, path).pipe(
          Effect.map((canonicalParent) => path.join(canonicalParent, pathSegment(target)))
        )
      }
      return Effect.fail(makeSqliteInvalidPath(target, error))
    })
  )

const pathSegment = (target: string): string => {
  const normalized = target.replaceAll("\\", "/")
  return normalized.slice(normalized.lastIndexOf("/") + 1)
}

const makeSqliteInvalidPath = (path: string, cause: unknown): SqliteInvalidArgumentError =>
  new SqliteInvalidArgumentError({
    field: "filename",
    operation: "SqlClientLive",
    message: formatUnknownError(cause),
    cause: Option.some({ path, cause })
  })

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
