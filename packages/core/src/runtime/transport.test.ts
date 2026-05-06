import { expect, test } from "bun:test"

import { Cause, Effect, Exit, Fiber, Stream } from "effect"

import {
  FrameDecoder,
  FrameTooLargeError,
  FrameTruncatedError,
  MAX_FRAME_BYTES,
  TransportFrameTooLargeError,
  TransportFrameTruncatedError,
  TransportInvalidArgumentError,
  TransportClosedError,
  createFramedTransport,
  encodeFrame
} from "./transport.js"
import { makeConnection, makeInMemoryTransportPair, makeTransport } from "./transport.js"

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

test("createFramedTransport sends encoded frames and receives decoded frames", async () => {
  const written: Uint8Array[] = []
  const transport = createFramedTransport(
    chunks(
      new Uint8Array([0, 0]),
      new Uint8Array([0, 2, 0x6f, 0x6b, 0, 0, 0, 5, 0x68]),
      new Uint8Array([0x65, 0x6c, 0x6c, 0x6f])
    ),
    (chunk) => {
      written.push(chunk)
    }
  )

  await transport.send(new Uint8Array([0x68, 0x69]))

  expect(written.map((frame) => Array.from(frame))).toEqual([[0, 0, 0, 2, 0x68, 0x69]])
  expect(Array.from((await transport.recv()) ?? [])).toEqual([0x6f, 0x6b])
  expect(Array.from((await transport.recv()) ?? [])).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f])
  expect(await transport.recv()).toBeNull()
})

test("Transport service frames and unframes length-prefixed payloads", async () => {
  const transport = await Effect.runPromise(makeTransport())
  const framed = await Effect.runPromise(
    transport.frame({ scheme: "length-prefixed", payload: new Uint8Array([0x6f, 0x6b]) })
  )
  const decoded = await Effect.runPromise(
    transport.unframe({ scheme: "length-prefixed", bytes: framed })
  )

  expect(Array.from(framed)).toEqual([0, 0, 0, 2, 0x6f, 0x6b])
  expect(decoded.map((frame) => Array.from(frame))).toEqual([[0x6f, 0x6b]])
})

test("Transport service frames and unframes JSON-RPC Content-Length payloads", async () => {
  const transport = await Effect.runPromise(makeTransport())
  const payload = new TextEncoder().encode(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })
  )
  const framed = await Effect.runPromise(transport.frame({ scheme: "json-rpc", payload }))
  const decoded = await Effect.runPromise(transport.unframe({ scheme: "json-rpc", bytes: framed }))

  expect(
    new TextDecoder().decode(framed).startsWith(`Content-Length: ${payload.byteLength}\r\n\r\n`)
  ).toBe(true)
  expect(decoded.map((frame) => new TextDecoder().decode(frame))).toEqual([
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })
  ])
})

test("Transport service unframes split stream chunks incrementally", async () => {
  const transport = await Effect.runPromise(makeTransport())
  const payload = new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id: 1, result: true }))
  const framed = await Effect.runPromise(transport.frame({ scheme: "json-rpc", payload }))
  const frames = await Effect.runPromise(
    transport
      .unframeStream({
        scheme: "json-rpc",
        chunks: Stream.fromIterable([framed.slice(0, 5), framed.slice(5, 18), framed.slice(18)])
      })
      .pipe(Stream.runCollect)
  )

  expect(Array.from(frames).map((frame) => new TextDecoder().decode(frame))).toEqual([
    JSON.stringify({ jsonrpc: "2.0", id: 1, result: true })
  ])
})

test("Transport service returns typed failures for invalid input and bad frames", async () => {
  const transport = await Effect.runPromise(makeTransport())

  const invalid = await Effect.runPromiseExit(
    transport.frame({ scheme: "length-prefixed", payload: new Uint8Array([1]), maxFrameBytes: 0 })
  )
  const tooLarge = await Effect.runPromiseExit(
    transport.frame({
      scheme: "length-prefixed",
      payload: new Uint8Array([1, 2]),
      maxFrameBytes: 1
    })
  )
  const truncated = await Effect.runPromiseExit(
    transport.unframe({ scheme: "length-prefixed", bytes: new Uint8Array([0, 0]) })
  )
  const malformedHeader = await Effect.runPromiseExit(
    transport.unframe({
      scheme: "json-rpc",
      bytes: new TextEncoder().encode("X-Header: nope\r\n\r\n{}")
    })
  )
  const malformedInput = await Effect.runPromiseExit(
    transport.frame(null as unknown as Parameters<typeof transport.frame>[0])
  )

  expectFailure(invalid, TransportInvalidArgumentError)
  expectFailure(tooLarge, TransportFrameTooLargeError)
  expectFailure(truncated, TransportFrameTruncatedError)
  expectFailure(malformedHeader, TransportInvalidArgumentError)
  expectFailure(malformedInput, TransportInvalidArgumentError)
  expect(getFailure(malformedHeader)).toMatchObject({ field: "header" })
})

test("in-memory transport pair substitutes a scoped host protocol transport", async () => {
  const [left, right] = await Effect.runPromise(makeInMemoryTransportPair())
  const fiber = Effect.runFork(right.receive.pipe(Stream.take(1), Stream.runCollect))

  await Effect.runPromise(left.send(new Uint8Array([0x68, 0x69])))
  const received = Array.from(await Effect.runPromise(Fiber.join(fiber))).map((chunk) =>
    Array.from(chunk)
  )

  expect(received).toEqual([[0x68, 0x69]])
  await Effect.runPromise(left.close())
  await Effect.runPromise(right.close())
})

test("connection close stops receives with a typed closed failure", async () => {
  const transport = createFramedTransport(chunks(), () => {
    return
  })
  const connection = makeConnection(transport, "test")

  await Effect.runPromise(connection.close())
  const exit = await Effect.runPromiseExit(
    connection.receive.pipe(Stream.take(1), Stream.runCollect)
  )

  expectFailure(exit, TransportClosedError)
})

async function* chunks(...values: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const value of values) {
    yield value
  }
}

function expectFailure<E>(
  exit: Exit.Exit<unknown, E>,
  errorClass: abstract new (...args: never[]) => E
): void {
  const error = getFailure(exit)
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
