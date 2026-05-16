import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"

import { RendererPgliteLive, type RendererPgliteOptions } from "./sql-pglite.js"

test("RendererPgliteLive produces a Layer", () => {
  const layer = RendererPgliteLive()
  expect(Layer.isLayer(layer)).toBe(true)
})

test("RendererPgliteLive accepts dataDir option", () => {
  const layer = RendererPgliteLive({ dataDir: "/tmp/test-db" })
  expect(Layer.isLayer(layer)).toBe(true)
})

test("RendererPgliteOptions accepts optional dataDir only", () => {
  const withDir: RendererPgliteOptions = { dataDir: "/data" }
  const withoutDir: RendererPgliteOptions = {}
  expect(withDir.dataDir).toBe("/data")
  expect(withoutDir.dataDir).toBeUndefined()
})

test("RendererPgliteLive dynamic import resolves and layer builds successfully", async () => {
  const layer = RendererPgliteLive()
  const context = await Effect.runPromise(Effect.scoped(Layer.build(layer)))
  expect(context).toBeDefined()
})
