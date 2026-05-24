import { expect, test } from "bun:test"
import {
  HostProtocolResponseEnvelope,
  PTY_DISPOSE_METHOD,
  PTY_KILL_METHOD,
  PTY_OPEN_METHOD,
  PTY_READ_METHOD,
  PTY_RESIZE_METHOD,
  PTY_WAIT_METHOD,
  PTY_WRITE_METHOD,
  type HostProtocolRequestEnvelope
} from "@orika/bridge"
import { PTY, ResourceOwner, ResourceRegistryLive } from "@orika/core"
import { Deferred, Effect, Exit, Layer, ManagedRuntime, Option, Stream } from "effect"

import { NativePtyLayer } from "./index.js"

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

test("NativePtyLayer opens PTY through host methods and exposes the core handle contract", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = fakePtyExchange(requests)
      const result = yield* runScoped(
        Effect.gen(function* () {
          const pty = yield* PTY
          const handle = yield* pty.open({
            argv: ["/bin/zsh", "-l"],
            rows: 24,
            cols: 80
          })

          yield* handle.write(textEncoder.encode("echo native\n"))
          yield* handle.resize({ rows: 30, cols: 100 })
          yield* handle.kill("SIGTERM")
          const output = yield* handle.output.pipe(Stream.runCollect)
          const status = yield* handle.onExit

          return {
            pid: handle.pid,
            output: decodeChunks(Array.from(output)),
            status
          }
        }),
        nativePtyTestLayer(exchange, { spawn: ["/bin/zsh"] })
      )

      expect(Option.getOrUndefined(result.pid)).toBe(1234)
      expect(result.output).toBe("native-pty-ok")
      expect(result.status).toMatchObject({ code: 0 })
      const methods = requests.map((request) => request.method)
      const disposeIndex = methods.indexOf(PTY_DISPOSE_METHOD)
      const lastReadIndex = methods.lastIndexOf(PTY_READ_METHOD)

      expect(methods[0]).toBe(PTY_OPEN_METHOD)
      expect(methods).toContain(PTY_WRITE_METHOD)
      expect(methods).toContain(PTY_RESIZE_METHOD)
      expect(methods).toContain(PTY_KILL_METHOD)
      expect(methods).toContain(PTY_WAIT_METHOD)
      expect(methods.filter((method) => method === PTY_READ_METHOD)).toHaveLength(2)
      expect(disposeIndex).toBeGreaterThan(lastReadIndex)
    })
  ))

test("NativePtyLayer preserves PTY spawn permissions before host access", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const exchange = fakePtyExchange(requests)
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const pty = yield* PTY
          return yield* Effect.exit(
            pty.open({
              argv: ["/bin/zsh"],
              rows: 24,
              cols: 80
            })
          )
        }),
        nativePtyTestLayer(exchange, { spawn: ["/bin/bash"] })
      )

      expect(Exit.isFailure(exit)).toBe(true)
      expect(requests).toEqual([])
    })
  ))

const nativePtyTestLayer = (
  exchange: Parameters<typeof NativePtyLayer>[0]["exchange"],
  permissions: { readonly spawn: readonly string[] }
) =>
  Layer.provide(
    NativePtyLayer({ exchange, permissions }),
    Layer.merge(ResourceRegistryLive, ResourceOwner.test("native-pty-test"))
  ).pipe(Layer.orDie)

const fakePtyExchange = (requests: HostProtocolRequestEnvelope[]) => {
  let readCount = 0
  const exitReady = Effect.runSync(Deferred.make<void>())
  return {
    request: (request: HostProtocolRequestEnvelope) =>
      Effect.gen(function* () {
        requests.push(request)
        switch (request.method) {
          case PTY_OPEN_METHOD:
            return response(request, { ptyId: "pty-1", pid: 1234 })
          case PTY_READ_METHOD:
            readCount += 1
            return response(
              request,
              readCount === 1
                ? { bytesBase64: "bmF0aXZlLXB0eS1vaw==", done: false }
                : { bytesBase64: "", done: true }
            )
          case PTY_KILL_METHOD:
            yield* Deferred.succeed(exitReady, undefined)
            return response(request)
          case PTY_WAIT_METHOD:
            yield* Deferred.await(exitReady)
            return response(request, { code: 0 })
          default:
            return response(request)
        }
      })
  }
}

const response = (
  request: HostProtocolRequestEnvelope,
  payload?: unknown
): HostProtocolResponseEnvelope =>
  new HostProtocolResponseEnvelope({
    kind: "response",
    id: request.id,
    timestamp: request.timestamp + 1,
    traceId: request.traceId,
    ...(payload === undefined ? {} : { payload })
  })

const runScoped = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const result = yield* Effect.promise(() => runtime.runPromise(effect))
    yield* Effect.promise(() => runtime.dispose())
    return result
  })

const decodeChunks = (chunks: readonly Uint8Array[]): string =>
  chunks.map((chunk) => textDecoder.decode(chunk)).join("")
