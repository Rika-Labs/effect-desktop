import { Layer } from "effect"
import * as SqliteWasmClient from "@effect/sql-sqlite-wasm/SqliteClient"
import * as SqlClientNs from "effect/unstable/sql/SqlClient"
import type { SqlClient } from "effect/unstable/sql/SqlClient"
import { SqlError } from "effect/unstable/sql/SqlError"
import * as SqlModel from "effect/unstable/sql/SqlModel"

export { SqlClientNs as SqlClient, SqlError, SqlModel }
export { SqliteWasmClient }

export type RendererSqliteClient = SqliteWasmClient.SqliteClient

export type RendererSqliteMemoryOptions = SqliteWasmClient.SqliteClientMemoryConfig

export type RendererSqliteWorkerOptions = SqliteWasmClient.SqliteClientConfig

export const RendererSqliteMemoryLive = (
  options: RendererSqliteMemoryOptions = {}
): Layer.Layer<SqliteWasmClient.SqliteClient | SqlClient, SqlError> =>
  SqliteWasmClient.layerMemory(options)

export const RendererSqliteWorkerLive = (
  options: RendererSqliteWorkerOptions
): Layer.Layer<SqliteWasmClient.SqliteClient | SqlClient, SqlError> =>
  SqliteWasmClient.layer(options)
