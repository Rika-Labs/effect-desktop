import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"

import { AutoSaveError, AutoSaveService, makeAutoSaveLayer } from "./auto-save.js"

test("AutoSave: runs local flush cadence with plain Effect scope", async () => {
  const calls: string[] = []

  const autoSaveSvcLayer = Layer.succeed(AutoSaveService, {
    flush: (target) =>
      Effect.sync(() => {
        calls.push(target)
      })
  })

  const layer = makeAutoSaveLayer({ target: "session-1", interval: "1 millis" }).pipe(
    Layer.provide(autoSaveSvcLayer)
  )

  await Effect.runPromise(Effect.scoped(Effect.sleep("5 millis").pipe(Effect.provide(layer))))

  expect(calls).toContain("session-1")
})

test("AutoSave: retries transient local flush failures without Workflow", async () => {
  let attempts = 0

  const autoSaveSvcLayer = Layer.succeed(AutoSaveService, {
    flush: (target) =>
      Effect.gen(function* () {
        attempts += 1
        if (attempts < 3) {
          return yield* Effect.fail(
            new AutoSaveError({
              target,
              message: "transient flush failure",
              cause: "test"
            })
          )
        }
      })
  })

  const layer = makeAutoSaveLayer({ target: "doc-1", interval: "1 millis", retries: 2 }).pipe(
    Layer.provide(autoSaveSvcLayer)
  )

  await Effect.runPromise(Effect.scoped(Effect.sleep("5 millis").pipe(Effect.provide(layer))))

  expect(attempts).toBeGreaterThanOrEqual(3)
})
