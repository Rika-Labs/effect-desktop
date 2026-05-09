import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { TestRunner } from "effect/unstable/cluster"

import { WindowEntity, WindowEntityLayer } from "./window-entity.js"

const TestLayer = Layer.mergeAll(
  WindowEntityLayer.pipe(Layer.provide(TestRunner.layer)),
  TestRunner.layer
)

test("WindowEntity: focus and state via TestRunner", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* WindowEntity.client
      const win = client("window-a")

      yield* win.WindowFocus()
      yield* win.WindowSetTitle({ title: "Hello Cluster" })
      return yield* win.WindowGetState()
    }).pipe(Effect.provide(TestLayer))
  )

  expect(result.focused).toBe(true)
  expect(result.title).toBe("Hello Cluster")
})

test("WindowEntity: two windows have independent state", async () => {
  const result = await Effect.runPromise(
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
    }).pipe(Effect.provide(TestLayer))
  )

  expect(result.stateA.title).toBe("Window A")
  expect(result.stateA.focused).toBe(true)
  expect(result.stateB.title).toBe("Window B")
  expect(result.stateB.focused).toBe(false)
})
