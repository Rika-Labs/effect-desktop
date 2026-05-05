export const MAX_FRAME_BYTES = 4 * 1024 * 1024

const LENGTH_PREFIX_BYTES = 4
const U32_MAX = 0xffff_ffff

export class FrameTooLargeError extends Error {
  override readonly name = "FrameTooLargeError"
  readonly size: number
  readonly max: number

  constructor(size: number, max: number) {
    super(`frame size ${size} exceeds maxFrameBytes ${max}`)
    this.size = size
    this.max = max
  }
}

export class FrameTruncatedError extends Error {
  override readonly name = "FrameTruncatedError"
  readonly stage: "length" | "body"
  readonly expected: number
  readonly read: number

  constructor(stage: "length" | "body", expected: number, read: number) {
    super(`frame ${stage} truncated after ${read} of ${expected} bytes`)
    this.stage = stage
    this.expected = expected
    this.read = read
  }
}

export class InvalidFrameLimitError extends Error {
  override readonly name = "InvalidFrameLimitError"
  readonly maxFrameBytes: number

  constructor(maxFrameBytes: number) {
    super(`invalid maxFrameBytes ${maxFrameBytes}; expected an integer from 0 to ${U32_MAX}`)
    this.maxFrameBytes = maxFrameBytes
  }
}

export interface FramedTransportOptions {
  readonly maxFrameBytes?: number
}

export interface FramedTransport {
  readonly send: (payload: Uint8Array) => Promise<void>
  readonly recv: () => Promise<Uint8Array | null>
}

export const encodeFrame = (
  payload: Uint8Array,
  options: FramedTransportOptions = {}
): Uint8Array => {
  const maxFrameBytes = resolveMaxFrameBytes(options)
  if (payload.byteLength > maxFrameBytes) {
    throw new FrameTooLargeError(payload.byteLength, maxFrameBytes)
  }

  const frame = new Uint8Array(LENGTH_PREFIX_BYTES + payload.byteLength)
  new DataView(frame.buffer, frame.byteOffset, LENGTH_PREFIX_BYTES).setUint32(
    0,
    payload.byteLength,
    false
  )
  frame.set(payload, LENGTH_PREFIX_BYTES)

  return frame
}

export class FrameDecoder {
  readonly #maxFrameBytes: number
  readonly #chunks: Uint8Array[] = []
  #bufferedBytes = 0
  #expectedBodyBytes: number | null = null
  #headChunkIndex = 0
  #headChunkOffset = 0

  constructor(options: FramedTransportOptions = {}) {
    this.#maxFrameBytes = resolveMaxFrameBytes(options)
  }

  push(chunk: Uint8Array): Uint8Array[] {
    if (chunk.byteLength > 0) {
      this.#chunks.push(chunk)
      this.#bufferedBytes += chunk.byteLength
    }

    const frames: Uint8Array[] = []

    while (true) {
      if (this.#expectedBodyBytes === null) {
        if (this.#bufferedBytes < LENGTH_PREFIX_BYTES) {
          return frames
        }

        const prefix = this.#readBytes(LENGTH_PREFIX_BYTES)
        const length = new DataView(
          prefix.buffer,
          prefix.byteOffset,
          LENGTH_PREFIX_BYTES
        ).getUint32(0, false)

        if (length > this.#maxFrameBytes) {
          throw new FrameTooLargeError(length, this.#maxFrameBytes)
        }

        this.#expectedBodyBytes = length
      }

      if (this.#bufferedBytes < this.#expectedBodyBytes) {
        return frames
      }

      frames.push(this.#readBytes(this.#expectedBodyBytes))
      this.#expectedBodyBytes = null
    }
  }

  finish(): void {
    if (this.#expectedBodyBytes === null) {
      if (this.#bufferedBytes === 0) {
        return
      }

      throw new FrameTruncatedError("length", LENGTH_PREFIX_BYTES, this.#bufferedBytes)
    }

    throw new FrameTruncatedError("body", this.#expectedBodyBytes, this.#bufferedBytes)
  }

  #readBytes(byteLength: number): Uint8Array {
    const bytes = new Uint8Array(byteLength)
    let copied = 0

    while (copied < byteLength) {
      const chunk = this.#chunks[this.#headChunkIndex]
      if (chunk === undefined) {
        throw new Error("frame decoder buffer underflow")
      }

      const available = chunk.byteLength - this.#headChunkOffset
      const take = Math.min(byteLength - copied, available)
      bytes.set(chunk.subarray(this.#headChunkOffset, this.#headChunkOffset + take), copied)

      copied += take
      this.#bufferedBytes -= take
      this.#headChunkOffset += take

      if (this.#headChunkOffset === chunk.byteLength) {
        this.#headChunkIndex += 1
        this.#headChunkOffset = 0
        this.#compactConsumedChunks()
      }
    }

    return bytes
  }

  #compactConsumedChunks(): void {
    if (this.#headChunkIndex === 0) {
      return
    }

    if (this.#headChunkIndex === this.#chunks.length) {
      this.#chunks.length = 0
      this.#headChunkIndex = 0
      return
    }

    if (this.#headChunkIndex < 32 && this.#headChunkIndex * 2 < this.#chunks.length) {
      return
    }

    this.#chunks.splice(0, this.#headChunkIndex)
    this.#headChunkIndex = 0
  }
}

export const createFramedTransport = (
  input: AsyncIterable<Uint8Array>,
  write: (chunk: Uint8Array) => Promise<void> | void,
  options: FramedTransportOptions = {}
): FramedTransport => {
  const decoder = new FrameDecoder(options)
  const inputIterator = input[Symbol.asyncIterator]()
  const pendingFrames: Uint8Array[] = []

  let inputEnded = false

  return {
    send: async (payload) => {
      await write(encodeFrame(payload, options))
    },
    recv: async () => {
      const pending = pendingFrames.shift()
      if (pending !== undefined) {
        return pending
      }

      while (!inputEnded) {
        const next = await inputIterator.next()
        if (next.done === true) {
          inputEnded = true
          decoder.finish()
          return pendingFrames.shift() ?? null
        }

        pendingFrames.push(...decoder.push(next.value))
        const decoded = pendingFrames.shift()
        if (decoded !== undefined) {
          return decoded
        }
      }

      return null
    }
  }
}

export const createBunStdioTransport = (): FramedTransport =>
  createFramedTransport(readableStreamToAsyncIterable(Bun.stdin.stream()), async (chunk) => {
    await Bun.write(Bun.stdout, chunk)
  })

const readableStreamToAsyncIterable = (
  stream: ReadableStream<Uint8Array>
): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    const reader = stream.getReader()

    try {
      while (true) {
        const result = await reader.read()
        if (result.done === true) {
          return
        }

        yield result.value
      }
    } finally {
      reader.releaseLock()
    }
  }
})

const resolveMaxFrameBytes = (options: FramedTransportOptions): number => {
  const maxFrameBytes = options.maxFrameBytes ?? MAX_FRAME_BYTES
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 0 || maxFrameBytes > U32_MAX) {
    throw new InvalidFrameLimitError(maxFrameBytes)
  }

  return maxFrameBytes
}
