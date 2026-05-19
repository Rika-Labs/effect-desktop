import { expect, test } from "bun:test"
import { Deferred, Effect, Layer, ManagedRuntime, Schema } from "effect"

import { AutoSaveError, AutoSaveService, makeAutoSaveLayer } from "./auto-save.js"

class AutoSaveTimeout extends Schema.TaggedErrorClass<AutoSaveTimeout>()("AutoSaveTimeout", {}) {}

const runScoped = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<A, E | LE, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const exit = yield* Effect.promise(() => runtime.runPromiseExit(effect))
    yield* Effect.promise(() => runtime.dispose())
    return yield* exit
  })

test("AutoSave: runs local flush cadence with plain Effect scope", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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

      yield* runScoped(Effect.sleep("100 millis"), layer)

      expect(calls).toContain("session-1")
    })
  ))

test("AutoSave: retries transient local flush failures without Workflow", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let attempts = 0
      const retried = yield* Deferred.make<void>()

      const autoSaveSvcLayer = Layer.succeed(AutoSaveService, {
        flush: (target) =>
          Effect.gen(function* () {
            attempts += 1
            if (attempts >= 3) {
              yield* Deferred.succeed(retried, undefined)
            }
            if (attempts < 3) {
              return yield* new AutoSaveError({
                target,
                message: "transient flush failure",
                cause: "test"
              })
            }
          })
      })

      const layer = makeAutoSaveLayer({ target: "doc-1", interval: "1 millis", retries: 2 }).pipe(
        Layer.provide(autoSaveSvcLayer)
      )

      const timeout = Effect.gen(function* () {
        yield* Effect.sleep("1 second")
        return yield* new AutoSaveTimeout()
      })

      yield* runScoped(Effect.raceFirst(Deferred.await(retried), timeout), layer)

      expect(attempts).toBe(3)
    })
  ))
