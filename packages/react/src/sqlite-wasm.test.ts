import { expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import {
  RendererSqliteMemoryLive,
  RendererSqliteWorkerLive,
  SqliteWasmClient,
  SqlClient,
  SqlError,
  SqlModel,
  type RendererSqliteMemoryOptions,
  type RendererSqliteWorkerOptions
} from "./sqlite-wasm.js"
import type { SqlError as SqlErrorType } from "effect/unstable/sql/SqlError"

test("RendererSqliteMemoryLive produces a Layer without options", () => {
  const layer = RendererSqliteMemoryLive()
  expect(layer).toBeDefined()
  expect(layer).toBeInstanceOf(Object)
})

test("RendererSqliteMemoryLive accepts optional config", () => {
  const options: RendererSqliteMemoryOptions = {
    installReactivityHooks: true,
    spanAttributes: { "db.name": "renderer" }
  }
  const layer = RendererSqliteMemoryLive(options)
  expect(layer).toBeDefined()
})

test("RendererSqliteWorkerLive accepts a worker effect", () => {
  const options: RendererSqliteWorkerOptions = {
    worker: Effect.die("worker not available in test environment")
  }
  const layer = RendererSqliteWorkerLive(options)
  expect(layer).toBeDefined()
  expect(layer).toBeInstanceOf(Object)
})

test("SqliteWasmClient namespace is exported", () => {
  expect(SqliteWasmClient).toBeDefined()
  expect(typeof SqliteWasmClient.layerMemory).toBe("function")
  expect(typeof SqliteWasmClient.layer).toBe("function")
})

test("SqlClient namespace is exported", () => {
  expect(SqlClient).toBeDefined()
})

test("SqlError is exported", () => {
  expect(SqlError).toBeDefined()
})

test("SqlModel is exported", () => {
  expect(SqlModel).toBeDefined()
  expect(typeof SqlModel.makeRepository).toBe("function")
})

test("RendererSqliteMemoryLive Layer provides SqlClient", () => {
  const layer = RendererSqliteMemoryLive()
  expect(Layer.isLayer(layer)).toBe(true)
})

test("in-memory SQLite executes a schema migration and round-trips a row", () => {
  const runtime = ManagedRuntime.make(
    RendererSqliteMemoryLive() as Layer.Layer<SqlClient.SqlClient, SqlErrorType>
  )
  return runtime.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, body TEXT NOT NULL)`
      yield* sql`INSERT INTO drafts (id, body) VALUES (${"draft-1"}, ${"hello renderer"})`
      const rows = yield* sql`SELECT id, body FROM drafts WHERE id = ${"draft-1"}`

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: "draft-1", body: "hello renderer" })
    })
  )
})
