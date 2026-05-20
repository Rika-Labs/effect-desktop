import { expect, test } from "bun:test"
import { Effect, Exit, Layer, ManagedRuntime, Schema } from "effect"
import { Socket } from "effect/unstable/socket"
import { layerStdioSocket, writeStdout } from "./stdio-socket.js"

class WriteStdoutError extends Schema.TaggedErrorClass<WriteStdoutError>()(
  "WriteStdoutError",
  {}
) {}

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

test("layerStdioSocket provides a Socket.Socket service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* runScoped(
        Effect.gen(function* () {
          const socket = yield* Socket.Socket.asEffect()
          return typeof socket.run
        }),
        layerStdioSocket
      )

      expect(result).toBe("function")
    })
  ))

test("layerStdioSocket socket writer is scoped", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* runScoped(
        Effect.scoped(
          Effect.gen(function* () {
            const socket = yield* Socket.Socket.asEffect()
            const write = yield* socket.writer
            return typeof write
          })
        ),
        layerStdioSocket
      )

      expect(result).toBe("function")
    })
  ))

test("writeStdout completes through the callback boundary", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const narrowed: Effect.Effect<void, WriteStdoutError, never> = writeStdout("").pipe(
        Effect.mapError(() => new WriteStdoutError())
      )
      const exit = yield* Effect.exit(narrowed)

      expect(Exit.isSuccess(exit)).toBe(true)
    })
  ))
