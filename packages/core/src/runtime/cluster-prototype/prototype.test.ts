import { expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { TestRunner } from "effect/unstable/cluster"

import { WindowEntity, WindowEntityLayer } from "./window-entity.js"

const TestLayer = Layer.mergeAll(
  WindowEntityLayer.pipe(Layer.provide(TestRunner.layer)),
  TestRunner.layer
)

test("WindowEntity: focus and state via TestRunner", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* WindowEntity.client
          const win = client("window-a")

          yield* win.WindowFocus()
          yield* win.WindowSetTitle({ title: "Hello Cluster" })
          return yield* win.WindowGetState()
        }),
        TestLayer
      )

      expect(result.focused).toBe(true)
      expect(result.title).toBe("Hello Cluster")
    })
  ))

test("WindowEntity: two windows have independent state", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* WindowEntity.client
          const winA = client("window-a")
          const winB = client("window-b")

          yield* winA.WindowSetTitle({ title: "Window A" })
          yield* winB.WindowSetTitle({ title: "Window B" })
          yield* winA.WindowFocus()

          const stateA = yield* winA.WindowGetState()
          const stateB = yield* winB.WindowGetState()
          return { stateA, stateB }
        }),
        TestLayer
      )

      expect(result.stateA.title).toBe("Window A")
      expect(result.stateA.focused).toBe(true)
      expect(result.stateB.title).toBe("Window B")
      expect(result.stateB.focused).toBe(false)
    })
  ))

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
