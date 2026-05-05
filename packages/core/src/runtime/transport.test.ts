import { expect, test } from "bun:test"

import {
  FrameDecoder,
  FrameTooLargeError,
  FrameTruncatedError,
  MAX_FRAME_BYTES,
  createFramedTransport,
  encodeFrame
} from "./transport.js"

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

async function* chunks(...values: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const value of values) {
    yield value
  }
}
