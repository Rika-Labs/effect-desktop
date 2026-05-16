import { Effect, Layer } from "effect"
import * as SqliteWasmClient from "@effect/sql-sqlite-wasm/SqliteClient"
import * as SqlClientNs from "effect/unstable/sql/SqlClient"
import type { SqlClient } from "effect/unstable/sql/SqlClient"
import { SqlError } from "effect/unstable/sql/SqlError"
import * as SqlModel from "effect/unstable/sql/SqlModel"

export { SqlClientNs as SqlClient, SqlError, SqlModel }
export { SqliteWasmClient }

export type RendererSqliteClient = SqliteWasmClient.SqliteClient

export interface RendererSqliteMemoryOptions {
  readonly installReactivityHooks?: boolean | undefined
  readonly spanAttributes?: Record<string, unknown> | undefined
  readonly transformResultNames?: ((str: string) => string) | undefined
  readonly transformQueryNames?: ((str: string) => string) | undefined
}

export interface RendererSqliteWorkerOptions {
  readonly worker: Effect.Effect<Worker | SharedWorker | MessagePort, never, never>
  readonly installReactivityHooks?: boolean | undefined
  readonly spanAttributes?: Record<string, unknown> | undefined
  readonly transformResultNames?: ((str: string) => string) | undefined
  readonly transformQueryNames?: ((str: string) => string) | undefined
}

const memoryOptions = (
  options: RendererSqliteMemoryOptions
): SqliteWasmClient.SqliteClientMemoryConfig => ({
  ...(options.installReactivityHooks !== undefined
    ? { installReactivityHooks: options.installReactivityHooks }
    : {}),
  ...(options.spanAttributes !== undefined ? { spanAttributes: options.spanAttributes } : {}),
  ...(options.transformResultNames !== undefined
    ? { transformResultNames: options.transformResultNames }
    : {}),
  ...(options.transformQueryNames !== undefined
    ? { transformQueryNames: options.transformQueryNames }
    : {})
})

const workerConfig = (
  options: RendererSqliteWorkerOptions
): SqliteWasmClient.SqliteClientConfig => ({
  worker: options.worker,
  ...(options.installReactivityHooks !== undefined
    ? { installReactivityHooks: options.installReactivityHooks }
    : {}),
  ...(options.spanAttributes !== undefined ? { spanAttributes: options.spanAttributes } : {}),
  ...(options.transformResultNames !== undefined
    ? { transformResultNames: options.transformResultNames }
    : {}),
  ...(options.transformQueryNames !== undefined
    ? { transformQueryNames: options.transformQueryNames }
    : {})
})

export const RendererSqliteMemoryLive = (
  options: RendererSqliteMemoryOptions = {}
): Layer.Layer<SqliteWasmClient.SqliteClient | SqlClient, SqlError> =>
  SqliteWasmClient.layerMemory(memoryOptions(options))

export const RendererSqliteWorkerLive = (
  options: RendererSqliteWorkerOptions
): Layer.Layer<SqliteWasmClient.SqliteClient | SqlClient, SqlError> =>
  SqliteWasmClient.layer(workerConfig(options))
