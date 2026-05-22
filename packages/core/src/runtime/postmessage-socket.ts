import { Deferred, Effect, Layer, Queue, Stream } from "effect"
import { Socket } from "effect/unstable/socket"

interface WindowLike {
  readonly addEventListener: (type: "message", handler: (event: MessageEvent) => void) => void
  readonly removeEventListener: (type: "message", handler: (event: MessageEvent) => void) => void
  readonly postMessage: (message: unknown, targetOrigin: string) => void
  readonly location?: { readonly origin?: string }
}

const getWindow = (): WindowLike | undefined => {
  const g = globalThis as Record<string, unknown>
  const w = g["window"]
  return typeof w === "object" && w !== null ? (w as WindowLike) : undefined
}

const makePostMessageSocket: Effect.Effect<Socket.Socket> = Effect.gen(function* () {
  const closeSignal = yield* Deferred.make<void>()
  const makeInbound = (onOpen: Effect.Effect<void> | undefined) =>
    Stream.callback<Uint8Array, Socket.SocketError>((queue) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const listener = (event: MessageEvent) => {
            const win = getWindow()
            if (!isAllowedMessageSender(win, event)) {
              return
            }
            const data: unknown = event.data
            if (data instanceof Uint8Array) {
              Queue.offerUnsafe(queue, data)
            } else if (data instanceof ArrayBuffer) {
              Queue.offerUnsafe(queue, new Uint8Array(data))
            } else if (typeof data === "string") {
              Queue.offerUnsafe(queue, new TextEncoder().encode(data))
            }
          }

          const win = getWindow()
          if (win !== undefined) {
            win.addEventListener("message", listener)
          }

          if (onOpen !== undefined) {
            yield* onOpen
          }

          return listener
        }),
        (listener) =>
          Effect.sync(() => {
            getWindow()?.removeEventListener("message", listener)
          })
      )
    )

  const runRaw = <_, E, R>(
    handler: (_: string | Uint8Array) => Effect.Effect<_, E, R> | void,
    opts?: { readonly onOpen?: Effect.Effect<void> | undefined }
  ): Effect.Effect<void, Socket.SocketError | E, R> =>
    Effect.race(
      makeInbound(opts?.onOpen).pipe(
        Stream.runForEach((item) => {
          const result = handler(item)
          return Effect.isEffect(result) ? result : Effect.void
        })
      ),
      Deferred.await(closeSignal).pipe(
        Effect.flatMap(() =>
          Effect.fail(
            new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1000 }) })
          )
        )
      )
    )

  const write = (
    chunk: Uint8Array | string | Socket.CloseEvent
  ): Effect.Effect<void, Socket.SocketError> => {
    if (Socket.isCloseEvent(chunk)) {
      return Deferred.complete(closeSignal, Effect.void).pipe(Effect.asVoid)
    }
    return Effect.sync(() => {
      const data = chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(chunk)
      const win = getWindow()
      const targetOrigin = currentWindowOrigin(win)
      if (win !== undefined && targetOrigin !== undefined) {
        win.postMessage(data, targetOrigin)
      }
    })
  }

  const writer = Effect.acquireRelease(Effect.succeed(write), () => Effect.void)

  return Socket.make({ runRaw, writer })
})

export const layerPostMessageSocket: Layer.Layer<Socket.Socket> = Layer.effect(
  Socket.Socket,
  makePostMessageSocket
)

const currentWindowOrigin = (win: WindowLike | undefined): string | undefined => {
  const origin = win?.location?.origin
  return origin === "" ? undefined : origin
}

const isAllowedMessageSender = (win: WindowLike | undefined, event: MessageEvent): boolean => {
  const expectedOrigin = currentWindowOrigin(win)
  return expectedOrigin !== undefined && event.origin === expectedOrigin && event.source === win
}
