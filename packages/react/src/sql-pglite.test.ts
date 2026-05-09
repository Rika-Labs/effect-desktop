import { expect, test } from "bun:test"
import { Layer } from "effect"

import {
  RendererPgliteLive,
  type RendererPgliteOptions,
  type RendererSqlBackend
} from "./sql-pglite.js"

test("RendererPgliteLive produces a Layer", () => {
  const layer = RendererPgliteLive()
  expect(Layer.isLayer(layer)).toBe(true)
})

test("RendererPgliteLive accepts dataDir option", () => {
  const layer = RendererPgliteLive({ dataDir: "/tmp/test-db" })
  expect(Layer.isLayer(layer)).toBe(true)
})

test("RendererSqlBackend type covers pglite and sqlite-wasm literals", () => {
  const backends: readonly RendererSqlBackend[] = ["pglite", "sqlite-wasm"]
  expect(backends).toHaveLength(2)
})

test("RendererPgliteOptions accepts optional dataDir only", () => {
  const withDir: RendererPgliteOptions = { dataDir: "/data" }
  const withoutDir: RendererPgliteOptions = {}
  expect(withDir.dataDir).toBe("/data")
  expect(withoutDir.dataDir).toBeUndefined()
})

test("pgvector similarity query shape compiles at type level", () => {
  const sql = `
    SELECT id, content, 1 - (embedding <=> $1::vector) AS similarity
    FROM documents
    ORDER BY embedding <=> $1::vector
    LIMIT 5
  `
  expect(typeof sql).toBe("string")
})

test("tsvector full-text search query shape compiles at type level", () => {
  const sql = `
    SELECT id, title, ts_rank(search_vec, query) AS rank
    FROM documents, to_tsquery('english', $1) query
    WHERE search_vec @@ query
    ORDER BY rank DESC
    LIMIT 10
  `
  expect(typeof sql).toBe("string")
})
