import { expect, test } from "bun:test"
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Schedule,
  Stream
} from "effect"

import {
  makeFrameworkRuntime,
  makeFrameworkScopedOperation,
  runRendererStream
} from "./renderer-stream.js"

class RuntimeValue extends Context.Service<RuntimeValue, { readonly value: string }>()(
  "RuntimeValue"
) {}

test("framework runtime supplies non-empty Effect environments", async () => {
  const runtime = ManagedRuntime.make(Layer.succeed(RuntimeValue)({ value: "from-runtime" }))
  const frameworkRuntime = makeFrameworkRuntime(runtime)

  const fiber = frameworkRuntime.runFork(
    Effect.gen(function* () {
      const service = yield* RuntimeValue
      return service.value
    })
  )
  const exit = await Effect.runPromise(Fiber.await(fiber))

  await Effect.runPromise(frameworkRuntime.disposeEffect)
  await Effect.runPromise(runtime.disposeEffect)
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
  await Effect.runPromise(frameworkRuntime.disposeEffect)
  await Effect.runPromise(runtime.disposeEffect)
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
  await Effect.runPromise(frameworkRuntime.disposeEffect)
  await Effect.runPromise(runtime.disposeEffect)
})

test("scoped framework callback operations ignore stale interrupted exits", async () => {
  const runtime = ManagedRuntime.make(Layer.empty)
  const frameworkRuntime = makeFrameworkRuntime(runtime)
  const operation = makeFrameworkScopedOperation(frameworkRuntime)
  const interrupted = await Effect.runPromise(Deferred.make<void>())
  const exits: Array<Exit.Exit<string, never>> = []

  operation.runLatest(
    Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
    (exit) => {
      exits.push(exit)
    }
  )
  operation.runLatest(Effect.succeed("second"), (exit) => {
    exits.push(exit)
  })

  await Effect.runPromise(Deferred.await(interrupted))
  await waitFor(() => exits.length === 1)

  const exit = exits[0]
  expect(exit).toBeDefined()
  if (exit === undefined) {
    throw new Error("expected callback exit")
  }
  expect(Exit.isSuccess(exit)).toBe(true)
  if (Exit.isSuccess(exit)) {
    expect(exit.value).toBe("second")
  }

  operation.dispose()
  await Effect.runPromise(frameworkRuntime.disposeEffect)
  await Effect.runPromise(runtime.disposeEffect)
})

const waitFor = async (predicate: () => boolean): Promise<void> => {
  await Effect.runPromise(
    Effect.suspend(() =>
      predicate() ? Effect.void : Effect.fail(new Error("condition not met"))
    ).pipe(
      Effect.retry(Schedule.spaced("0 millis").pipe(Schedule.both(Schedule.recurs(20)))),
      Effect.mapError(() => new Error("timed out waiting for condition"))
    )
  )
}
