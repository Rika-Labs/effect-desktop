import { Deferred, Effect, Layer, Queue, Scope } from "effect"
import { Socket } from "effect/unstable/socket"

interface WindowLike {
  readonly addEventListener: (type: "message", handler: (event: MessageEvent) => void) => void
  readonly removeEventListener: (type: "message", handler: (event: MessageEvent) => void) => void
  readonly postMessage: (message: unknown, targetOrigin: string) => void
}

const getWindow = (): WindowLike | undefined => {
  const g = globalThis as Record<string, unknown>
  const w = g["window"]
  return typeof w === "object" && w !== null ? (w as WindowLike) : undefined
}

const makePostMessageSocket: Effect.Effect<Socket.Socket> = Effect.gen(function* () {
  const inbound = yield* Queue.unbounded<Uint8Array, Socket.SocketError>()
  const closeSignal = yield* Deferred.make<void>()

  const runRaw = <_, E, R>(
    handler: (_: string | Uint8Array) => Effect.Effect<_, E, R> | void,
    opts?: { readonly onOpen?: Effect.Effect<void> | undefined }
  ): Effect.Effect<void, Socket.SocketError | E, R> =>
    Effect.scopedWith(
      Effect.fnUntraced(function* (scope: Scope.Scope) {
        const listener = (event: MessageEvent) => {
          const data: unknown = event.data
          if (data instanceof Uint8Array) {
            Queue.offerUnsafe(inbound, data)
          } else if (data instanceof ArrayBuffer) {
            Queue.offerUnsafe(inbound, new Uint8Array(data))
          } else if (typeof data === "string") {
            Queue.offerUnsafe(inbound, new TextEncoder().encode(data))
          }
        }

        const win = getWindow()
        if (win !== undefined) {
          win.addEventListener("message", listener)
        }

        yield* Scope.addFinalizer(
          scope,
          Effect.sync(() => {
            getWindow()?.removeEventListener("message", listener)
          })
        )

        if (opts?.onOpen) yield* opts.onOpen

        while (true) {
          const item = yield* Effect.race(
            Queue.take(inbound),
            Deferred.await(closeSignal).pipe(
              Effect.flatMap(() =>
                Effect.fail(
                  new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1000 }) })
                )
              )
            )
          )
          const result = handler(item)
          if (Effect.isEffect(result)) yield* result
        }
      })
    )

  const write = (
    chunk: Uint8Array | string | Socket.CloseEvent
  ): Effect.Effect<void, Socket.SocketError> => {
    if (Socket.isCloseEvent(chunk)) {
      return Deferred.complete(closeSignal, Effect.void).pipe(Effect.asVoid)
    }
    return Effect.sync(() => {
      const data = chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(chunk)
      getWindow()?.postMessage(data, "*")
    })
  }

  const writer = Effect.acquireRelease(Effect.succeed(write), () => Effect.void)

  return Socket.make({ runRaw, writer })
})

export const layerPostMessageSocket: Layer.Layer<Socket.Socket> = Layer.effect(
  Socket.Socket,
  makePostMessageSocket
)
