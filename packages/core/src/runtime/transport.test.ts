import { expect, test } from "bun:test"

import { Cause, Clock, Deferred, Effect, Exit, Fiber, Option, Schema, Stream } from "effect"
import { Socket } from "effect/unstable/socket"
import { makeBridgeInspector } from "@orika/bridge"

import {
  FrameDecoder,
  FrameTooLargeError,
  FrameTruncatedError,
  MAX_FRAME_BYTES,
  TransportCloseError,
  TransportReadError,
  TransportFrameTooLargeError,
  TransportFrameTruncatedError,
  TransportInvalidArgumentError,
  TransportClosedError,
  encodeFrame,
  instrumentTransportConnection,
  makeFramedSocketConnection,
  makeInMemoryTransportPair,
  makeTransport
} from "./transport.js"

const encodeUnknownJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

test("encodeFrame emits a big-endian length prefix", () => {
  const frame = encodeFrame(new Uint8Array([0x68, 0x69]))

  expect(Array.from(frame)).toEqual([0, 0, 0, 2, 0x68, 0x69])
})

test("FrameDecoder decodes concatenated frames", () => {
  const decoder = new FrameDecoder()
  const frames = decoder.push(
    new Uint8Array([0, 0, 0, 2, 0x6f, 0x6b, 0, 0, 0, 5, 0x68, 0x65, 0x6c, 0x6c, 0x6f])
  )

  expect(frames.map((frame) => Array.from(frame))).toEqual([
    [0x6f, 0x6b],
    [0x68, 0x65, 0x6c, 0x6c, 0x6f]
  ])
  expect(decoder.finish()).toBeUndefined()
})

test("FrameDecoder decodes partial chunks", () => {
  const decoder = new FrameDecoder()

  expect(decoder.push(new Uint8Array([0, 0]))).toEqual([])
  expect(decoder.push(new Uint8Array([0, 5, 0x68]))).toEqual([])

  const frames = decoder.push(new Uint8Array([0x65, 0x6c, 0x6c, 0x6f]))

  expect(frames.map((frame) => Array.from(frame))).toEqual([[0x68, 0x65, 0x6c, 0x6c, 0x6f]])
})

test("FrameDecoder decodes byte-fragmented frames", () => {
  const decoder = new FrameDecoder()
  const frame = encodeFrame(new Uint8Array([0x66, 0x72, 0x61, 0x6d, 0x65]))
  const frames: Uint8Array[] = []

  for (const byte of frame) {
    frames.push(...decoder.push(new Uint8Array([byte])))
  }

  expect(frames.map((decoded) => Array.from(decoded))).toEqual([[0x66, 0x72, 0x61, 0x6d, 0x65]])
  expect(decoder.finish()).toBeUndefined()
})

test("FrameDecoder rejects oversized frames before body bytes", () => {
  const decoder = new FrameDecoder()
  const prefix = new Uint8Array(4)
  new DataView(prefix.buffer).setUint32(0, MAX_FRAME_BYTES + 1, false)

  expect(() => decoder.push(prefix)).toThrow(FrameTooLargeError)
})

test("FrameDecoder reports truncated length and body", () => {
  const lengthDecoder = new FrameDecoder()
  lengthDecoder.push(new Uint8Array([0, 0]))

  expect(() => lengthDecoder.finish()).toThrow(FrameTruncatedError)

  const bodyDecoder = new FrameDecoder()
  bodyDecoder.push(new Uint8Array([0, 0, 0, 4, 0x6f, 0x6b]))

  expect(() => bodyDecoder.finish()).toThrow(FrameTruncatedError)
})

test("encodeFrame rejects oversized payloads without writing", () => {
  expect(() => encodeFrame(new Uint8Array([1, 2, 3]), { maxFrameBytes: 2 })).toThrow(
    FrameTooLargeError
  )
})

test("makeFramedSocketConnection sends encoded frames and receives decoded frames", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const test = yield* makeTestSocket([
            new Uint8Array([0, 0]),
            new Uint8Array([0, 2, 0x6f, 0x6b, 0, 0, 0, 5, 0x68]),
            new Uint8Array([0x65, 0x6c, 0x6c, 0x6f])
          ])
          const connection = yield* makeFramedSocketConnection(test.socket)

          yield* connection.send(new Uint8Array([0x68, 0x69]))
          const received = yield* connection.receive.pipe(Stream.take(2), Stream.runCollect)

          return {
            written: test.written.map((frame) => Array.from(frame)),
            received: Array.from(received).map((frame) => Array.from(frame))
          }
        })
      )

      expect(result.written).toEqual([[0, 0, 0, 2, 0x68, 0x69]])
      expect(result.received).toEqual([
        [0x6f, 0x6b],
        [0x68, 0x65, 0x6c, 0x6c, 0x6f]
      ])
    })
  ))

test("instrumentTransportConnection emits typed transport inspector events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const events: unknown[] = []
      const inspector = yield* makeBridgeInspector({
        onEvent: (event) =>
          Effect.sync(() => {
            events.push(event)
          })
      })
      const [client] = yield* makeInMemoryTransportPair()
      const connection = instrumentTransportConnection(client, {
        inspector,
        target: "stdio"
      })

      yield* Effect.gen(function* () {
        yield* connection.send(new Uint8Array([1, 2, 3]))
        yield* connection.close()
      }).pipe(Effect.provideService(Clock.Clock, fixedClock(42)))

      expect(events).toContainEqual(
        expect.objectContaining({
          kind: "transport.backpressure",
          boundary: "host",
          method: "stdio",
          timestamp: 42,
          payload: { bytes: 3 }
        })
      )
      expect(events).toContainEqual(
        expect.objectContaining({
          kind: "transport.disconnect",
          boundary: "host",
          method: "stdio",
          timestamp: 42
        })
      )
    })
  ))

test("makeFramedSocketConnection uses the provided Socket service through Transport.connect", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const test = yield* makeTestSocket([encodeFrame(new Uint8Array([0x6f, 0x6b]))])
          const transport = yield* makeTransport()
          const connection = yield* transport
            .connect({ target: "stdio" })
            .pipe(Effect.provideService(Socket.Socket, test.socket))
          const received = yield* connection.receive.pipe(Stream.take(1), Stream.runCollect)

          return Array.from(received).map((frame) => Array.from(frame))
        })
      )

      expect(result).toEqual([[0x6f, 0x6b]])
    })
  ))

test("makeFramedSocketConnection close stops receives with a typed closed failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.scoped(
          Effect.gen(function* () {
            const test = yield* makeTestSocket([], { waitForClose: true })
            const connection = yield* makeFramedSocketConnection(test.socket)

            yield* connection.close()
            return yield* connection.receive.pipe(Stream.take(1), Stream.runCollect)
          })
        )
      )

      expectFailure(exit, TransportClosedError)
    })
  ))

test("makeFramedSocketConnection reports socket read failures as typed read failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.scoped(
          Effect.gen(function* () {
            const test = yield* makeTestSocket([], { failRead: true })
            const connection = yield* makeFramedSocketConnection(test.socket, {}, "test")

            return yield* connection.receive.pipe(Stream.take(1), Stream.runCollect)
          })
        )
      )

      expectFailure(exit, TransportReadError)
      expect(exit.pipe(getFailure)).toMatchObject({ operation: "test.receive" })
    })
  ))

test("makeFramedSocketConnection preserves frame validation failures from reads", () => {
  const oversizedPrefix = new Uint8Array(4)
  new DataView(oversizedPrefix.buffer).setUint32(0, MAX_FRAME_BYTES + 1, false)
  return Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.scoped(
          Effect.gen(function* () {
            const test = yield* makeTestSocket([oversizedPrefix])
            const connection = yield* makeFramedSocketConnection(test.socket, {}, "test")

            return yield* connection.receive.pipe(Stream.take(1), Stream.runCollect)
          })
        )
      )

      expectFailure(exit, TransportFrameTooLargeError)
      expect(exit.pipe(getFailure)).toMatchObject({ operation: "test.receive" })
    })
  )
})

test("makeFramedSocketConnection finalizes partial frames on clean socket close", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.scoped(
          Effect.gen(function* () {
            const test = yield* makeTestSocket([new Uint8Array([0, 0])], {
              cleanCloseAfterChunks: true
            })
            const connection = yield* makeFramedSocketConnection(test.socket, {}, "test")

            return yield* connection.receive.pipe(Stream.runCollect)
          })
        )
      )

      expectFailure(exit, TransportFrameTruncatedError)
      expect(exit.pipe(getFailure)).toMatchObject({ operation: "test.receive" })
    })
  ))

test("makeFramedSocketConnection fails connect when the socket fails before opening", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.scoped(
          Effect.gen(function* () {
            const test = yield* makeTestSocket([], { failOpen: true })

            return yield* makeFramedSocketConnection(test.socket, {}, "test").pipe(
              Effect.timeout("50 millis")
            )
          })
        )
      )

      expectFailure(exit, TransportReadError)
      expect(exit.pipe(getFailure)).toMatchObject({ operation: "test.receive" })
    })
  ))

test("Transport service frames and unframes length-prefixed payloads", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const transport = yield* makeTransport()
      const framed = yield* transport.frame({
        scheme: "length-prefixed",
        payload: new Uint8Array([0x6f, 0x6b])
      })
      const decoded = yield* transport.unframe({ scheme: "length-prefixed", bytes: framed })

      expect(Array.from(framed)).toEqual([0, 0, 0, 2, 0x6f, 0x6b])
      expect(decoded.map((frame) => Array.from(frame))).toEqual([[0x6f, 0x6b]])
    })
  ))

test("Transport service frames and unframes JSON-RPC Content-Length payloads", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const transport = yield* makeTransport()
      const encoded = encodeUnknownJson({ jsonrpc: "2.0", id: 1, method: "ping" })
      const payload = new TextEncoder().encode(encoded)
      const framed = yield* transport.frame({ scheme: "json-rpc", payload })
      const decoded = yield* transport.unframe({ scheme: "json-rpc", bytes: framed })

      expect(
        new TextDecoder().decode(framed).startsWith(`Content-Length: ${payload.byteLength}\r\n\r\n`)
      ).toBe(true)
      expect(decoded.map((frame) => new TextDecoder().decode(frame))).toEqual([encoded])
    })
  ))

test("Transport service unframes split stream chunks incrementally", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const transport = yield* makeTransport()
      const encoded = encodeUnknownJson({ jsonrpc: "2.0", id: 1, result: true })
      const payload = new TextEncoder().encode(encoded)
      const framed = yield* transport.frame({ scheme: "json-rpc", payload })
      const frames = yield* transport
        .unframeStream({
          scheme: "json-rpc",
          chunks: Stream.fromIterable([framed.slice(0, 5), framed.slice(5, 18), framed.slice(18)])
        })
        .pipe(Stream.runCollect)

      expect(Array.from(frames).map((frame) => new TextDecoder().decode(frame))).toEqual([encoded])
    })
  ))

test("unframeStream validates frameQueueCapacity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const transport = yield* makeTransport()
      const invalid = yield* Effect.exit(
        transport
          .unframeStream({
            scheme: "json-rpc",
            frameQueueCapacity: 0,
            chunks: Stream.empty
          })
          .pipe(Stream.runCollect)
      )

      expectFailure(invalid, TransportInvalidArgumentError)
    })
  ))

test("Transport service validates unframeStream chunks input", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const transport = yield* makeTransport()
      const missing = yield* Effect.exit(
        transport
          .unframeStream({ scheme: "length-prefixed" })
          .pipe(Stream.take(1), Stream.runCollect)
      )
      const malformed = yield* Effect.exit(
        transport
          .unframeStream({
            scheme: "length-prefixed",
            chunks: { pipe: "not a function" }
          })
          .pipe(Stream.take(1), Stream.runCollect)
      )

      expectFailure(missing, TransportInvalidArgumentError)
      expectFailure(malformed, TransportInvalidArgumentError)
    })
  ))

test("Transport service returns typed failures for invalid input and bad frames", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const transport = yield* makeTransport()

      const invalid = yield* Effect.exit(
        transport.frame({
          scheme: "length-prefixed",
          payload: new Uint8Array([1]),
          maxFrameBytes: 0
        })
      )
      const tooLarge = yield* Effect.exit(
        transport.frame({
          scheme: "length-prefixed",
          payload: new Uint8Array([1, 2]),
          maxFrameBytes: 1
        })
      )
      const truncated = yield* Effect.exit(
        transport.unframe({ scheme: "length-prefixed", bytes: new Uint8Array([0, 0]) })
      )
      const malformedHeader = yield* Effect.exit(
        transport.unframe({
          scheme: "json-rpc",
          bytes: new TextEncoder().encode("X-Header: nope\r\n\r\n{}")
        })
      )
      const malformedInput = yield* Effect.exit(transport.frame(null))

      expectFailure(invalid, TransportInvalidArgumentError)
      expectFailure(tooLarge, TransportFrameTooLargeError)
      expectFailure(truncated, TransportFrameTruncatedError)
      expectFailure(malformedHeader, TransportInvalidArgumentError)
      expectFailure(malformedInput, TransportInvalidArgumentError)
      expect(malformedHeader.pipe(getFailure)).toMatchObject({ field: "header" })
    })
  ))

test("JSON-RPC unframe rejects invalid UTF-8 in headers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const transport = yield* makeTransport()
      const framed = new Uint8Array([
        ...new TextEncoder().encode("Content-Length: 2\r\nX-Header: "),
        0xff,
        ...new TextEncoder().encode("\r\n\r\nok")
      ])
      const exit = yield* Effect.exit(
        transport.unframe({
          scheme: "json-rpc",
          bytes: framed
        })
      )

      expectFailure(exit, TransportInvalidArgumentError)
      expect(exit.pipe(getFailure)).toMatchObject({
        field: "header"
      })
    })
  ))

test("JSON-RPC unframe requires decimal digit Content-Length values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const transport = yield* makeTransport()

      for (const value of ["+2", "-2", "2.0", "2e0", "NaN", "Infinity", ""]) {
        const exit = yield* Effect.exit(
          transport.unframe({
            scheme: "json-rpc",
            bytes: new TextEncoder().encode(`Content-Length: ${value}\r\n\r\n{}`)
          })
        )

        expectFailure(exit, TransportInvalidArgumentError)
        expect(exit.pipe(getFailure)).toMatchObject({ field: "header" })
      }

      const decoded = yield* transport.unframe({
        scheme: "json-rpc",
        bytes: new TextEncoder().encode("Content-Length:  2 \r\n\r\n{}")
      })
      expect(decoded.map((frame) => new TextDecoder().decode(frame))).toEqual(["{}"])
    })
  ))

test("JSON-RPC unframe rejects duplicate Content-Length headers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const transport = yield* makeTransport()

      for (const header of [
        "Content-Length: 2\r\nContent-Length: 999",
        "Content-Length: 2\r\nContent-Length: 2"
      ]) {
        const exit = yield* Effect.exit(
          transport.unframe({
            scheme: "json-rpc",
            bytes: new TextEncoder().encode(`${header}\r\n\r\n{}`)
          })
        )

        expectFailure(exit, TransportInvalidArgumentError)
        expect(exit.pipe(getFailure)).toMatchObject({ field: "header" })
      }
    })
  ))

test("in-memory transport pair accepts bounded queue capacity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const [left, right] = yield* makeInMemoryTransportPair({ queueCapacity: 1 })

      yield* left.send(new Uint8Array([0x68, 0x69]))
      const blockedSecond = yield* Effect.forkChild(left.send(new Uint8Array([0x6f, 0x6b])), {
        startImmediately: true
      })
      const blockedExit = yield* Fiber.join(blockedSecond).pipe(Effect.timeoutOption("25 millis"))

      expect(Option.isNone(blockedExit)).toBe(true)

      const received = yield* right.receive.pipe(Stream.take(2), Stream.runCollect)
      const collected = Array.from(received).map((chunk) => Array.from(chunk))
      expect(collected).toEqual([
        [0x68, 0x69],
        [0x6f, 0x6b]
      ])

      yield* Fiber.join(blockedSecond)
      yield* left.close()
      yield* right.close()
    })
  ))

test("in-memory transport pair substitutes a scoped host protocol transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const [left, right] = yield* makeInMemoryTransportPair()
      const fiber = yield* Effect.forkChild(right.receive.pipe(Stream.take(1), Stream.runCollect), {
        startImmediately: true
      })

      yield* left.send(new Uint8Array([0x68, 0x69]))
      const received = Array.from(yield* Fiber.join(fiber)).map((chunk) => Array.from(chunk))

      expect(received).toEqual([[0x68, 0x69]])
      yield* left.close()
      yield* right.close()
    })
  ))

test("in-memory transport rejects sends after close", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const [left, right] = yield* makeInMemoryTransportPair()

      yield* left.close()
      const exit = yield* Effect.exit(left.send(new Uint8Array([0x68])))

      expectFailure(exit, TransportClosedError)
      yield* right.close()
    })
  ))

test("connection close reports adapter close failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.scoped(
          Effect.gen(function* () {
            const test = yield* makeTestSocket([], { waitForClose: true, failClose: true })
            const connection = yield* makeFramedSocketConnection(test.socket, {}, "test")

            yield* connection.close()
          })
        )
      )

      expectFailure(exit, TransportCloseError)
      expect(exit.pipe(getFailure)).toMatchObject({ operation: "test.close" })
    })
  ))

const makeTestSocket = (
  inputChunks: ReadonlyArray<Uint8Array>,
  options: {
    readonly waitForClose?: boolean
    readonly failClose?: boolean
    readonly failRead?: boolean
    readonly failOpen?: boolean
    readonly cleanCloseAfterChunks?: boolean
  } = {}
): Effect.Effect<{ readonly socket: Socket.Socket; readonly written: Uint8Array[] }> =>
  Effect.gen(function* () {
    const closeSignal = yield* Deferred.make<void>()
    const written: Uint8Array[] = []
    const socket = Socket.make({
      runRaw: (handler, runOptions) =>
        Effect.gen(function* () {
          if (options.failOpen === true) {
            return yield* new Socket.SocketError({
              reason: new Socket.SocketOpenError({
                kind: "Unknown",
                cause: new Error("open failed")
              })
            })
          }
          if (runOptions?.onOpen !== undefined) {
            yield* runOptions.onOpen
          }
          if (options.failRead === true) {
            return yield* new Socket.SocketError({
              reason: new Socket.SocketReadError({ cause: new Error("read failed") })
            })
          }
          for (const chunk of inputChunks) {
            const result = handler(chunk)
            if (Effect.isEffect(result)) {
              yield* result
            }
          }
          if (options.cleanCloseAfterChunks === true) {
            return yield* new Socket.SocketError({
              reason: new Socket.SocketCloseError({ code: 1000 })
            })
          }
          if (options.waitForClose === true) {
            yield* Deferred.await(closeSignal)
          }
        }),
      writer: Effect.acquireRelease(
        Effect.succeed((chunk: Uint8Array | string | Socket.CloseEvent) => {
          if (Socket.isCloseEvent(chunk)) {
            if (options.failClose === true) {
              return Effect.fail(
                new Socket.SocketError({
                  reason: new Socket.SocketWriteError({ cause: new Error("close failed") })
                })
              )
            }
            return Deferred.succeed(closeSignal, undefined).pipe(Effect.asVoid)
          }
          return Effect.sync(() => {
            written.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk)
          })
        }),
        () => Effect.void
      )
    })

    return { socket, written }
  })

function expectFailure<E>(
  exit: Exit.Exit<unknown, E>,
  errorClass: abstract new (...args: never[]) => E
): void {
  const error = exit.pipe(getFailure)
  expect(error).toBeInstanceOf(errorClass)
}

function getFailure<E>(exit: Exit.Exit<unknown, E>): E | undefined {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    return failure?.error
  }
  return undefined
}

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.yieldNow
})
