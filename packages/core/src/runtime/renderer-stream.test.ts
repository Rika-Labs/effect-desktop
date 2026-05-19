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
  Schema,
  Stream
} from "effect"

import {
  makeFrameworkRuntime,
  makeFrameworkScopedOperation,
  runRendererStream
} from "./renderer-stream.js"

class RuntimeValue extends Context.Service<RuntimeValue, { readonly value: string }>()(
  "@effect-desktop/core/runtime/renderer-stream.test/RuntimeValue"
) {}

class ConditionNotMet extends Schema.TaggedErrorClass<ConditionNotMet>()("ConditionNotMet", {}) {}
class WaitForTimeout extends Schema.TaggedErrorClass<WaitForTimeout>()("WaitForTimeout", {}) {}
class CallbackExitMissing extends Schema.TaggedErrorClass<CallbackExitMissing>()(
  "CallbackExitMissing",
  {}
) {}

test("framework runtime supplies non-empty Effect environments", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = ManagedRuntime.make(Layer.succeed(RuntimeValue)({ value: "from-runtime" }))
      const frameworkRuntime = makeFrameworkRuntime(runtime)

      const fiber = frameworkRuntime.runFork(
        Effect.gen(function* () {
          const service = yield* RuntimeValue
          return service.value
        })
      )
      const exit = yield* Fiber.await(fiber)

      yield* frameworkRuntime.disposeEffect
      yield* runtime.disposeEffect
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toBe("from-runtime")
      }
    })
  ))

test("renderer streams run through the supplied framework runtime", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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

      yield* waitFor(() => emitted.length === 1)
      dispose()
      yield* frameworkRuntime.disposeEffect
      yield* runtime.disposeEffect
      expect(emitted).toEqual(["stream-runtime"])
    })
  ))

test("scoped framework operations replace the active fiber and interrupt on dispose", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = ManagedRuntime.make(Layer.empty)
      const frameworkRuntime = makeFrameworkRuntime(runtime)
      const operation = makeFrameworkScopedOperation(frameworkRuntime)
      const interrupted = yield* Deferred.make<void>()

      const first = operation.runLatestPromiseExit(
        Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined)))
      )
      const second = operation.runLatestPromiseExit(Effect.succeed("second"))

      yield* Deferred.await(interrupted)
      const [secondExit, secondIsLatest] = yield* Effect.promise(() => second)
      const [firstExit, firstIsLatest] = yield* Effect.promise(() => first)

      expect(Exit.isSuccess(secondExit)).toBe(true)
      expect(secondIsLatest).toBe(true)
      expect(Exit.isFailure(firstExit)).toBe(true)
      expect(firstIsLatest).toBe(false)

      operation.dispose()
      yield* frameworkRuntime.disposeEffect
      yield* runtime.disposeEffect
    })
  ))

test("scoped framework callback operations ignore stale interrupted exits", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = ManagedRuntime.make(Layer.empty)
      const frameworkRuntime = makeFrameworkRuntime(runtime)
      const operation = makeFrameworkScopedOperation(frameworkRuntime)
      const interrupted = yield* Deferred.make<void>()
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

      yield* Deferred.await(interrupted)
      yield* waitFor(() => exits.length === 1)

      const exit = exits[0]
      expect(exit).toBeDefined()
      if (exit === undefined) {
        return yield* new CallbackExitMissing()
      }
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value).toBe("second")
      }

      operation.dispose()
      yield* frameworkRuntime.disposeEffect
      yield* runtime.disposeEffect
    })
  ))

const waitFor = (predicate: () => boolean): Effect.Effect<void, WaitForTimeout, never> =>
  Effect.suspend(() => (predicate() ? Effect.void : Effect.fail(new ConditionNotMet()))).pipe(
    Effect.retry(Schedule.spaced("0 millis").pipe(Schedule.both(Schedule.recurs(20)))),
    Effect.mapError(() => new WaitForTimeout())
  )
