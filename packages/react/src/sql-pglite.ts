import { Effect, Layer } from "effect"
import type { SqlClient } from "effect/unstable/sql/SqlClient"
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError"

export type { PgliteClient } from "@effect/sql-pglite/PgliteClient"
export type { PgliteClientConfig } from "@effect/sql-pglite/PgliteClient"

export type RendererSqlBackend = "pglite" | "sqlite-wasm"

export interface RendererPgliteOptions {
  readonly dataDir?: string | undefined
}

export const RendererPgliteLive = (
  options: RendererPgliteOptions = {}
): Layer.Layer<SqlClient, SqlError> =>
  Layer.unwrap(
    Effect.map(
      Effect.tryPromise({
        try: () => import("@effect/sql-pglite"),
        catch: (cause) =>
          new SqlError({
            reason: new UnknownError({
              cause,
              message: "@effect/sql-pglite is not installed — add it to optionalDependencies",
              operation: "RendererPgliteLive.import"
            })
          })
      }),
      (mod) =>
        mod.PgliteClient.layer(
          options.dataDir === undefined ? {} : { dataDir: options.dataDir }
        ) as Layer.Layer<SqlClient, SqlError>
    )
  )
