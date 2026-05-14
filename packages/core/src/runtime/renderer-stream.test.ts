import { expect, test } from "bun:test"
import { Context, Effect, Exit, Layer, ManagedRuntime, Stream } from "effect"

import {
  makeFrameworkRuntime,
  runFrameworkPromiseExit,
  runRendererStream
} from "./renderer-stream.js"

class RuntimeValue extends Context.Service<RuntimeValue, { readonly value: string }>()(
  "RuntimeValue"
) {}

test("framework runtime supplies non-empty Effect environments", async () => {
  const runtime = ManagedRuntime.make(Layer.succeed(RuntimeValue)({ value: "from-runtime" }))
  const frameworkRuntime = makeFrameworkRuntime(runtime)

  const exit = await runFrameworkPromiseExit(
    frameworkRuntime,
    Effect.gen(function* () {
      const service = yield* RuntimeValue
      return service.value
    })
  )

  await frameworkRuntime.dispose()
  await runtime.dispose()
  expect(Exit.isSuccess(exit)).toBe(true)
  if (Exit.isSuccess(exit)) {
    expect(exit.value).toBe("from-runtime")
  }
})

test("renderer streams run through the supplied framework runtime", async () => {
  const runtime = ManagedRuntime.make(Layer.succeed(RuntimeValue)({ value: "stream-runtime" }))
  const frameworkRuntime = makeFrameworkRuntime(runtime)
  const emitted: string[] = []
  const stream: Stream.Stream<string, never, RuntimeValue> = Stream.fromEffect(
    Effect.gen(function* () {
      const service = yield* RuntimeValue
      return service.value
    })
  )

  const dispose = runRendererStream(
    frameworkRuntime,
    stream,
    {},
    (item) => {
      emitted.push(item)
    },
    () => undefined
  )

  await waitFor(() => emitted.length === 1)
  dispose()
  await frameworkRuntime.dispose()
  await runtime.dispose()
  expect(emitted).toEqual(["stream-runtime"])
})

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(predicate()).toBe(true)
}
