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
  #buffer: Uint8Array = new Uint8Array(0)
  #expectedBodyBytes: number | null = null

  constructor(options: FramedTransportOptions = {}) {
    this.#maxFrameBytes = resolveMaxFrameBytes(options)
  }

  push(chunk: Uint8Array): Uint8Array[] {
    if (chunk.byteLength > 0) {
      this.#buffer = concatBytes(this.#buffer, chunk)
    }

    const frames: Uint8Array[] = []

    while (true) {
      if (this.#expectedBodyBytes === null) {
        if (this.#buffer.byteLength < LENGTH_PREFIX_BYTES) {
          return frames
        }

        const length = new DataView(
          this.#buffer.buffer,
          this.#buffer.byteOffset,
          LENGTH_PREFIX_BYTES
        ).getUint32(0, false)
        this.#buffer = this.#buffer.slice(LENGTH_PREFIX_BYTES)

        if (length > this.#maxFrameBytes) {
          throw new FrameTooLargeError(length, this.#maxFrameBytes)
        }

        this.#expectedBodyBytes = length
      }

      if (this.#buffer.byteLength < this.#expectedBodyBytes) {
        return frames
      }

      frames.push(this.#buffer.slice(0, this.#expectedBodyBytes))
      this.#buffer = this.#buffer.slice(this.#expectedBodyBytes)
      this.#expectedBodyBytes = null
    }
  }

  finish(): void {
    if (this.#expectedBodyBytes === null) {
      if (this.#buffer.byteLength === 0) {
        return
      }

      throw new FrameTruncatedError("length", LENGTH_PREFIX_BYTES, this.#buffer.byteLength)
    }

    throw new FrameTruncatedError("body", this.#expectedBodyBytes, this.#buffer.byteLength)
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

const concatBytes = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  const bytes = new Uint8Array(left.byteLength + right.byteLength)
  bytes.set(left, 0)
  bytes.set(right, left.byteLength)
  return bytes
}
