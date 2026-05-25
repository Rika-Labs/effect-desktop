import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"

import { RendererPgliteLive, type PgliteClientConfig } from "./sql-pglite.js"

test("RendererPgliteLive does not maintain a narrowed local options mirror", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const moduleSource = yield* Effect.promise(() =>
        Bun.file(new URL("sql-pglite.ts", import.meta.url)).text()
      )

      expect(moduleSource).not.toContain("RendererPgliteOptions")
    })
  ))

test("RendererPgliteLive produces a Layer", () => {
  const layer = RendererPgliteLive()
  expect(Layer.isLayer(layer)).toBe(true)
})

test("RendererPgliteLive accepts upstream PgliteClientConfig", () => {
  const options: PgliteClientConfig = {
    dataDir: "/tmp/test-db",
    spanAttributes: { "db.system": "pglite" },
    transformJson: true
  }
  const layer = RendererPgliteLive(options)
  expect(Layer.isLayer(layer)).toBe(true)
})

test("RendererPgliteLive dynamic import resolves and layer builds successfully", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const layer = RendererPgliteLive()
      const context = yield* Effect.scoped(Layer.build(layer))
      expect(context).toBeDefined()
    })
  ))
