import { expect, test } from "bun:test"
import { Deferred, Effect, Exit, Layer, ManagedRuntime } from "effect"
import { Socket } from "effect/unstable/socket"
import { layerPostMessageSocket } from "./postmessage-socket.js"

class FakeWindow {
  readonly posted: unknown[] = []
  private readonly listeners = new Set<(event: MessageEvent) => void>()

  addEventListener(_type: "message", handler: (event: MessageEvent) => void): void {
    this.listeners.add(handler)
  }

  removeEventListener(_type: "message", handler: (event: MessageEvent) => void): void {
    this.listeners.delete(handler)
  }

  postMessage(message: unknown): void {
    this.posted.push(message)
  }

  dispatch(data: unknown): void {
    for (const listener of this.listeners) {
      listener({ data } as MessageEvent)
    }
  }

  get listenerCount(): number {
    return this.listeners.size
  }
}

const withFakeWindow = <A, E, R>(
  window: FakeWindow,
  run: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const hadWindow = Reflect.has(globalThis, "window")
      const previousWindow = Reflect.get(globalThis, "window")
      Reflect.set(globalThis, "window", window)
      return { hadWindow, previousWindow }
    }),
    () => run,
    ({ hadWindow, previousWindow }) =>
      Effect.sync(() => {
        if (hadWindow) {
          Reflect.set(globalThis, "window", previousWindow)
        } else {
          Reflect.deleteProperty(globalThis, "window")
        }
      })
  )

test("layerPostMessageSocket provides a Socket.Socket service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* runScoped(
        Effect.gen(function* () {
          const socket = yield* Socket.Socket.asEffect()
          return typeof socket.run
        }),
        layerPostMessageSocket
      )

      expect(result).toBe("function")
    })
  ))

test("layerPostMessageSocket socket writer is scoped", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* runScoped(
        Effect.gen(function* () {
          const socket = yield* Socket.Socket.asEffect()
          const write = yield* socket.writer
          return typeof write
        }).pipe(Effect.scoped),
        layerPostMessageSocket
      )

      expect(result).toBe("function")
    })
  ))

test("layerPostMessageSocket write emits nothing when window is absent", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* runScoped(
        Effect.gen(function* () {
          const socket = yield* Socket.Socket.asEffect()
          const write = yield* socket.writer
          yield* write(new Uint8Array([0x68, 0x69]))
          return "ok"
        }).pipe(Effect.scoped),
        layerPostMessageSocket
      )

      expect(result).toBe("ok")
    })
  ))

test("layerPostMessageSocket delivers window messages and unregisters listener", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const window = new FakeWindow()
      const received = yield* withFakeWindow(
        window,
        runScoped(
          Effect.gen(function* () {
            const socket = yield* Socket.Socket.asEffect()
            const opened = yield* Deferred.make<void>()
            const receivedChunk = yield* Deferred.make<Uint8Array>()
            yield* Effect.forkScoped(
              socket.run((chunk) => Deferred.succeed(receivedChunk, chunk).pipe(Effect.asVoid), {
                onOpen: Deferred.succeed(opened, undefined).pipe(Effect.asVoid)
              })
            )
            yield* Deferred.await(opened)
            expect(window.listenerCount).toBe(1)
            window.dispatch(new Uint8Array([0x68, 0x69]))
            return yield* Deferred.await(receivedChunk)
          }).pipe(Effect.scoped),
          layerPostMessageSocket
        )
      )

      expect([...received]).toEqual([0x68, 0x69])
      expect(window.listenerCount).toBe(0)
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
    return yield* exit as Exit.Exit<A, E | LE>
  })
