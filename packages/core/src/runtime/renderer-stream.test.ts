import { expect, test } from "bun:test"
import { Context, Deferred, Effect, Exit, Layer, ManagedRuntime, Stream } from "effect"

import {
  makeFrameworkRuntime,
  makeFrameworkScopedOperation,
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

test("scoped framework operations replace the active fiber and interrupt on dispose", async () => {
  const runtime = ManagedRuntime.make(Layer.empty)
  const frameworkRuntime = makeFrameworkRuntime(runtime)
  const operation = makeFrameworkScopedOperation(frameworkRuntime)
  const interrupted = await Effect.runPromise(Deferred.make<void>())

  const first = operation.runLatestPromiseExit(
    Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined)))
  )
  const second = operation.runLatestPromiseExit(Effect.succeed("second"))

  await Effect.runPromise(Deferred.await(interrupted))
  const [secondExit, secondIsLatest] = await second
  const [firstExit, firstIsLatest] = await first

  expect(Exit.isSuccess(secondExit)).toBe(true)
  expect(secondIsLatest).toBe(true)
  expect(Exit.isFailure(firstExit)).toBe(true)
  expect(firstIsLatest).toBe(false)

  operation.dispose()
  await frameworkRuntime.dispose()
  await runtime.dispose()
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
