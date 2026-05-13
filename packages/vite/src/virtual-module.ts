export const VIRTUAL_MODULE_ID = "virtual:effect-desktop/runtime"
export const RESOLVED_VIRTUAL_MODULE_ID = "\0virtual:effect-desktop/runtime"

export const FRAME_UP_EVENT = "effect-desktop:frame-up"
export const FRAME_DOWN_EVENT = "effect-desktop:frame-down"
export const RUNTIME_READY_EVENT = "effect-desktop:runtime-ready"
export const RUNTIME_RESTART_EVENT = "effect-desktop:runtime-restart"

export const buildVirtualModuleSource = (): string => `
import { Socket } from "effect/unstable/socket"
import { Deferred, Effect, Layer, Queue, Stream } from "effect"

const FRAME_DOWN = ${JSON.stringify(FRAME_DOWN_EVENT)}
const FRAME_UP = ${JSON.stringify(FRAME_UP_EVENT)}
const RUNTIME_READY = ${JSON.stringify(RUNTIME_READY_EVENT)}
const HMR_BUFFER_SIZE = 1024
let runtimeReady = false

const fromBase64 = (b64) => {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

const toBase64 = (bytes) => {
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

const makeDevSocket = () =>
  Effect.gen(function* () {
    const closeSignal = yield* Deferred.make()

    const awaitRuntimeReady = runtimeReady || !import.meta.hot
      ? Effect.void
      : Effect.async((resume) => {
          const onReady = () => {
            runtimeReady = true
            import.meta.hot?.off?.(RUNTIME_READY, onReady)
            resume(Effect.void)
          }
          import.meta.hot.on(RUNTIME_READY, onReady)
          return Effect.sync(() => import.meta.hot?.off?.(RUNTIME_READY, onReady))
        })

    const inbound = Stream.callback((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const onFrame = ({ data }) => {
            Queue.offerUnsafe(queue, fromBase64(data))
          }
          import.meta.hot?.on(FRAME_DOWN, onFrame)
          return onFrame
        }),
        (onFrame) => Effect.sync(() => import.meta.hot?.off?.(FRAME_DOWN, onFrame))
      ),
      { bufferSize: HMR_BUFFER_SIZE, strategy: "sliding" }
    )

    const runRaw = (handler, opts) =>
      Effect.gen(function* () {
        yield* awaitRuntimeReady

        if (opts?.onOpen) yield* opts.onOpen

        yield* Effect.race(
          inbound.pipe(
            Stream.runForEach((item) => {
              const result = handler(item)
              return Effect.isEffect(result) ? result : Effect.void
            })
          ),
          Deferred.await(closeSignal).pipe(
            Effect.flatMap(() =>
              Effect.fail(
                new Socket.SocketError({
                  reason: new Socket.SocketCloseError({ code: 1000 })
                })
              )
            )
          )
        )
      })

    const write = (chunk) => {
      if (Socket.isCloseEvent(chunk)) {
        return Deferred.complete(closeSignal, Effect.void).pipe(Effect.asVoid)
      }
      return Effect.sync(() => {
        const data = chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(chunk)
        if (import.meta.hot) {
          import.meta.hot.send(FRAME_UP, { data: toBase64(data) })
        }
      })
    }

    const writer = Effect.acquireRelease(Effect.succeed(write), () => Effect.void)

    return Socket.make({ runRaw, writer })
  })

export const layerDevSocket = Layer.effect(Socket.Socket, makeDevSocket())

if (import.meta.hot) {
  import.meta.hot.on(RUNTIME_READY, () => {
    runtimeReady = true
  })

  import.meta.hot.on(${JSON.stringify(RUNTIME_RESTART_EVENT)}, () => {
    import.meta.hot?.invalidate()
  })
}
`
