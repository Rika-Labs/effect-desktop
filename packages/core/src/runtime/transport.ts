import { Cause, Context, Data, Effect, Fiber, Option, Queue, Schema, Stream } from "effect"

export const MAX_FRAME_BYTES = 4 * 1024 * 1024

const LENGTH_PREFIX_BYTES = 4
const U32_MAX = 0xffff_ffff
const TEXT_ENCODER = new TextEncoder()
const TEXT_DECODER = new TextDecoder()
const JSON_RPC_HEADER_END = "\r\n\r\n"

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(U32_MAX))

export const TransportScheme = Schema.Literals(["length-prefixed", "json-rpc"])
export type TransportScheme = typeof TransportScheme.Type

export const TransportConnectTarget = Schema.Literals(["stdio"])
export type TransportConnectTarget = typeof TransportConnectTarget.Type

export class TransportFrameInput extends Schema.Class<TransportFrameInput>("TransportFrameInput")({
  scheme: TransportScheme,
  payload: Schema.Uint8Array,
  maxFrameBytes: Schema.optionalKey(PositiveInt)
}) {}

export class TransportUnframeInput extends Schema.Class<TransportUnframeInput>(
  "TransportUnframeInput"
)({
  scheme: TransportScheme,
  bytes: Schema.Uint8Array,
  maxFrameBytes: Schema.optionalKey(PositiveInt)
}) {}

export class TransportConnectInput extends Schema.Class<TransportConnectInput>(
  "TransportConnectInput"
)({
  target: TransportConnectTarget,
  maxFrameBytes: Schema.optionalKey(PositiveInt)
}) {}

export class TransportInvalidArgumentError extends Data.TaggedError("InvalidArgument")<{
  readonly operation: string
  readonly field: string
  readonly message: string
  readonly cause: Option.Option<unknown>
}> {}

export class TransportFrameTooLargeError extends Data.TaggedError("FrameTooLarge")<{
  readonly operation: string
  readonly size: number
  readonly max: number
}> {}

export class TransportFrameTruncatedError extends Data.TaggedError("FrameTruncated")<{
  readonly operation: string
  readonly stage: "length" | "body" | "header"
  readonly expected: number
  readonly read: number
}> {}

export class TransportClosedError extends Data.TaggedError("TransportClosed")<{
  readonly operation: string
}> {}

export class TransportWriteError extends Data.TaggedError("TransportWriteFailed")<{
  readonly operation: string
  readonly cause: Option.Option<unknown>
}> {}

export class TransportCloseError extends Data.TaggedError("TransportCloseFailed")<{
  readonly operation: string
  readonly cause: Option.Option<unknown>
}> {}

export type TransportError =
  | TransportInvalidArgumentError
  | TransportFrameTooLargeError
  | TransportFrameTruncatedError
  | TransportClosedError
  | TransportWriteError
  | TransportCloseError

export interface TransportConnection {
  readonly send: (payload: Uint8Array) => Effect.Effect<void, TransportError, never>
  readonly receive: Stream.Stream<Uint8Array, TransportError, never>
  readonly close: () => Effect.Effect<void, TransportError, never>
}

export interface TransportUnframeStreamInput {
  readonly scheme: TransportScheme
  readonly chunks: Stream.Stream<Uint8Array, TransportError, never>
  readonly maxFrameBytes?: number
}

export interface TransportApi {
  readonly frame: (input: TransportFrameInput) => Effect.Effect<Uint8Array, TransportError, never>
  readonly unframe: (
    input: TransportUnframeInput
  ) => Effect.Effect<readonly Uint8Array[], TransportError, never>
  readonly unframeStream: (
    input: TransportUnframeStreamInput
  ) => Stream.Stream<Uint8Array, TransportError, never>
  readonly connect: (
    input: TransportConnectInput
  ) => Effect.Effect<TransportConnection, TransportError, never>
}

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
  readonly close: () => Promise<void>
}

export const makeTransport = (): Effect.Effect<TransportApi, never, never> =>
  Effect.sync(() =>
    Object.freeze({
      frame: (input: TransportFrameInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeFrameInput(input, "Transport.frame")
          return yield* framePayload(decoded.scheme, decoded.payload, decoded, "Transport.frame")
        }).pipe(Effect.withSpan("Transport.frame")),
      unframe: (input: TransportUnframeInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeUnframeInput(input, "Transport.unframe")
          return yield* unframeBytes(decoded.scheme, decoded.bytes, decoded, "Transport.unframe")
        }).pipe(Effect.withSpan("Transport.unframe")),
      unframeStream: (input: TransportUnframeStreamInput) =>
        makeUnframeStream(input).pipe(Stream.withSpan("Transport.unframeStream")),
      connect: (input: TransportConnectInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeConnectInput(input, "Transport.connect")
          return makeConnection(createBunStdioTransport(decoded), "Transport.connect")
        }).pipe(Effect.withSpan("Transport.connect"))
    })
  )

export class Transport extends Context.Service<Transport, TransportApi>()("Transport", {
  make: makeTransport()
}) {}

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
  let closed = false

  return {
    send: async (payload) => {
      if (closed) {
        throw new Error("framed transport is closed")
      }
      await write(encodeFrame(payload, options))
    },
    recv: async () => {
      if (closed) {
        return null
      }

      const pending = pendingFrames.shift()
      if (pending !== undefined) {
        return pending
      }

      while (!inputEnded && !closed) {
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
    },
    close: async () => {
      closed = true
      await inputIterator.return?.()
    }
  }
}

export const createBunStdioTransport = (options: FramedTransportOptions = {}): FramedTransport =>
  createFramedTransport(
    readableStreamToAsyncIterable(Bun.stdin.stream()),
    async (chunk) => {
      await Bun.write(Bun.stdout, chunk)
    },
    options
  )

export const makeConnection = (
  transport: FramedTransport,
  operation: string
): TransportConnection =>
  Object.freeze({
    send: (payload: Uint8Array) =>
      Effect.tryPromise({
        try: () => transport.send(payload),
        catch: (error) => mapTransportError(error, `${operation}.send`)
      }),
    receive: Stream.fromEffectRepeat(
      Effect.tryPromise({
        try: () => transport.recv(),
        catch: (error) => mapTransportError(error, `${operation}.receive`)
      }).pipe(
        Effect.flatMap((frame) =>
          frame === null
            ? Effect.fail(new TransportClosedError({ operation: `${operation}.receive` }))
            : Effect.succeed(frame)
        )
      )
    ),
    close: () =>
      Effect.tryPromise({
        try: () => transport.close(),
        catch: (error) =>
          new TransportCloseError({
            operation: `${operation}.close`,
            cause: Option.some(error)
          })
      })
  })

export const makeInMemoryTransportPair = (): Effect.Effect<
  readonly [TransportConnection, TransportConnection],
  never,
  never
> =>
  Effect.gen(function* () {
    const leftInbound = yield* Queue.unbounded<Uint8Array, TransportError>()
    const rightInbound = yield* Queue.unbounded<Uint8Array, TransportError>()
    return [
      makeQueuedConnection(leftInbound, rightInbound, "Transport.memory.left"),
      makeQueuedConnection(rightInbound, leftInbound, "Transport.memory.right")
    ] as const
  })

const makeQueuedConnection = (
  inbound: Queue.Queue<Uint8Array, TransportError>,
  outbound: Queue.Queue<Uint8Array, TransportError>,
  operation: string
): TransportConnection =>
  Object.freeze({
    send: (payload: Uint8Array) =>
      Queue.offer(outbound, payload.slice()).pipe(
        Effect.mapError(
          (error) =>
            new TransportWriteError({
              operation: `${operation}.send`,
              cause: Option.some(error)
            })
        )
      ),
    receive: Stream.fromQueue(inbound),
    close: () =>
      Effect.gen(function* () {
        yield* Queue.shutdown(inbound)
        yield* Queue.shutdown(outbound)
      })
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

const framePayload = (
  scheme: TransportScheme,
  payload: Uint8Array,
  options: FramedTransportOptions,
  operation: string
): Effect.Effect<Uint8Array, TransportError, never> =>
  Effect.try({
    try: () =>
      scheme === "length-prefixed"
        ? encodeFrame(payload, options)
        : encodeJsonRpcFrame(payload, options),
    catch: (error) => mapTransportError(error, operation)
  })

const unframeBytes = (
  scheme: TransportScheme,
  bytes: Uint8Array,
  options: FramedTransportOptions,
  operation: string
): Effect.Effect<readonly Uint8Array[], TransportError, never> =>
  Effect.try({
    try: () =>
      scheme === "length-prefixed"
        ? decodeLengthPrefixedBytes(bytes, options)
        : decodeJsonRpcFrames(bytes, options),
    catch: (error) => mapTransportError(error, operation)
  })

const makeUnframeStream = (
  input: TransportUnframeStreamInput
): Stream.Stream<Uint8Array, TransportError, never> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const decoded = yield* decodeUnframeStreamInput(input, "Transport.unframeStream")
      const queue = yield* Queue.unbounded<Uint8Array, TransportError | Cause.Done>()
      const decoder =
        decoded.scheme === "length-prefixed"
          ? makeLengthPrefixedStreamingDecoder(decoded)
          : makeJsonRpcStreamingDecoder(decoded)
      const producer = yield* decoded.chunks
        .pipe(
          Stream.runForEach((chunk) =>
            Effect.gen(function* () {
              const frames = yield* decoder.push(chunk)
              for (const frame of frames) {
                yield* Queue.offer(queue, frame)
              }
            })
          ),
          Effect.andThen(
            Effect.gen(function* () {
              const frames = yield* decoder.finish()
              for (const frame of frames) {
                yield* Queue.offer(queue, frame)
              }
              yield* Queue.end(queue)
            })
          ),
          Effect.catch((error: TransportError) => Queue.fail(queue, error))
        )
        .pipe(Effect.forkScoped)

      return Stream.fromQueue(queue).pipe(
        Stream.ensuring(
          Effect.gen(function* () {
            yield* Queue.shutdown(queue)
            yield* Fiber.interrupt(producer)
          })
        )
      )
    })
  )

const decodeLengthPrefixedBytes = (
  bytes: Uint8Array,
  options: FramedTransportOptions
): readonly Uint8Array[] => {
  const decoder = new FrameDecoder(options)
  const frames = decoder.push(bytes)
  decoder.finish()
  return frames
}

interface StreamingFrameDecoder {
  readonly push: (chunk: Uint8Array) => Effect.Effect<readonly Uint8Array[], TransportError, never>
  readonly finish: () => Effect.Effect<readonly Uint8Array[], TransportError, never>
}

const makeLengthPrefixedStreamingDecoder = (
  options: FramedTransportOptions
): StreamingFrameDecoder => {
  const decoder = new FrameDecoder(options)
  return {
    push: (chunk) =>
      Effect.try({
        try: () => decoder.push(chunk),
        catch: (error) => mapTransportError(error, "Transport.unframeStream")
      }),
    finish: () =>
      Effect.try({
        try: () => {
          decoder.finish()
          return []
        },
        catch: (error) => mapTransportError(error, "Transport.unframeStream")
      })
  }
}

const makeJsonRpcStreamingDecoder = (options: FramedTransportOptions): StreamingFrameDecoder => {
  const decoder = new JsonRpcFrameDecoder(options)
  return {
    push: (chunk) =>
      Effect.try({
        try: () => decoder.push(chunk),
        catch: (error) => mapTransportError(error, "Transport.unframeStream")
      }),
    finish: () =>
      Effect.try({
        try: () => {
          decoder.finish()
          return []
        },
        catch: (error) => mapTransportError(error, "Transport.unframeStream")
      })
  }
}

const encodeJsonRpcFrame = (
  payload: Uint8Array,
  options: FramedTransportOptions = {}
): Uint8Array => {
  const maxFrameBytes = resolveMaxFrameBytes(options)
  if (payload.byteLength > maxFrameBytes) {
    throw new FrameTooLargeError(payload.byteLength, maxFrameBytes)
  }

  const header = TEXT_ENCODER.encode(`Content-Length: ${payload.byteLength}\r\n\r\n`)
  const frame = new Uint8Array(header.byteLength + payload.byteLength)
  frame.set(header, 0)
  frame.set(payload, header.byteLength)
  return frame
}

const decodeJsonRpcFrames = (
  bytes: Uint8Array,
  options: FramedTransportOptions = {}
): readonly Uint8Array[] => {
  const decoder = new JsonRpcFrameDecoder(options)
  const frames = decoder.push(bytes)
  decoder.finish()
  return frames
}

class JsonRpcFrameDecoder {
  readonly #maxFrameBytes: number
  #buffer: Uint8Array<ArrayBufferLike> = new Uint8Array()

  constructor(options: FramedTransportOptions = {}) {
    this.#maxFrameBytes = resolveMaxFrameBytes(options)
  }

  push(chunk: Uint8Array): readonly Uint8Array[] {
    this.#buffer = concatBytes(this.#buffer, chunk)
    const frames: Uint8Array[] = []

    while (this.#buffer.byteLength > 0) {
      const remainingText = TEXT_DECODER.decode(this.#buffer)
      const headerEnd = remainingText.indexOf(JSON_RPC_HEADER_END)
      if (headerEnd < 0) {
        return frames
      }

      const headerText = remainingText.slice(0, headerEnd)
      const contentLength = parseContentLength(headerText)
      if (contentLength > this.#maxFrameBytes) {
        throw new FrameTooLargeError(contentLength, this.#maxFrameBytes)
      }

      const bodyOffset = TEXT_ENCODER.encode(
        remainingText.slice(0, headerEnd + JSON_RPC_HEADER_END.length)
      ).byteLength
      const bodyEnd = bodyOffset + contentLength
      if (bodyEnd > this.#buffer.byteLength) {
        return frames
      }

      frames.push(this.#buffer.slice(bodyOffset, bodyEnd))
      this.#buffer = this.#buffer.slice(bodyEnd)
    }

    return frames
  }

  finish(): void {
    if (this.#buffer.byteLength === 0) {
      return
    }

    const remainingText = TEXT_DECODER.decode(this.#buffer)
    const headerEnd = remainingText.indexOf(JSON_RPC_HEADER_END)
    if (headerEnd < 0) {
      throw new JsonRpcFrameTruncatedError(
        "header",
        JSON_RPC_HEADER_END.length,
        this.#buffer.byteLength
      )
    }

    const headerText = remainingText.slice(0, headerEnd)
    const contentLength = parseContentLength(headerText)
    const bodyOffset = TEXT_ENCODER.encode(
      remainingText.slice(0, headerEnd + JSON_RPC_HEADER_END.length)
    ).byteLength
    throw new JsonRpcFrameTruncatedError(
      "body",
      contentLength,
      this.#buffer.byteLength - bodyOffset
    )
  }
}

const concatBytes = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  if (left.byteLength === 0) {
    return copyBytes(right)
  }
  if (right.byteLength === 0) {
    return copyBytes(left)
  }

  const bytes = new Uint8Array(left.byteLength + right.byteLength)
  bytes.set(left, 0)
  bytes.set(right, left.byteLength)
  return bytes
}

const copyBytes = (bytes: Uint8Array): Uint8Array => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

const parseContentLength = (headerText: string): number => {
  const line = headerText
    .split("\r\n")
    .find((candidate) => candidate.toLowerCase().startsWith("content-length:"))
  const value = line?.slice("content-length:".length).trim()
  const length = value === undefined ? Number.NaN : Number(value)
  if (!Number.isSafeInteger(length) || length < 0 || length > U32_MAX) {
    throw new JsonRpcFrameHeaderError(headerText)
  }

  return length
}

class JsonRpcFrameHeaderError extends Error {
  override readonly name = "JsonRpcFrameHeaderError"
  readonly headerText: string

  constructor(headerText: string) {
    super("json-rpc frame is missing a valid Content-Length header")
    this.headerText = headerText
  }
}

class JsonRpcFrameTruncatedError extends Error {
  override readonly name = "JsonRpcFrameTruncatedError"
  readonly stage: "header" | "body"
  readonly expected: number
  readonly read: number

  constructor(stage: "header" | "body", expected: number, read: number) {
    super(`json-rpc frame ${stage} truncated after ${read} of ${expected} bytes`)
    this.stage = stage
    this.expected = expected
    this.read = read
  }
}

const decodeFrameInput = (
  input: unknown,
  operation: string
): Effect.Effect<TransportFrameInput, TransportInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(TransportFrameInput)(input).pipe(
    Effect.mapError((error) => invalidArgument(operation, "input", error))
  )

const decodeUnframeInput = (
  input: unknown,
  operation: string
): Effect.Effect<TransportUnframeInput, TransportInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(TransportUnframeInput)(input).pipe(
    Effect.mapError((error) => invalidArgument(operation, "input", error))
  )

const decodeConnectInput = (
  input: unknown,
  operation: string
): Effect.Effect<TransportConnectInput, TransportInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(TransportConnectInput)(input).pipe(
    Effect.mapError((error) => invalidArgument(operation, "input", error))
  )

const decodeUnframeStreamInput = (
  input: TransportUnframeStreamInput,
  operation: string
): Effect.Effect<TransportUnframeStreamInput, TransportInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(
    Schema.Struct({
      scheme: TransportScheme,
      maxFrameBytes: Schema.optionalKey(PositiveInt)
    })
  )({
    scheme: input.scheme,
    ...(input.maxFrameBytes === undefined ? {} : { maxFrameBytes: input.maxFrameBytes })
  }).pipe(
    Effect.as(input),
    Effect.mapError((error) => invalidArgument(operation, "input", error))
  )

const invalidArgument = (
  operation: string,
  field: string,
  cause: unknown
): TransportInvalidArgumentError =>
  new TransportInvalidArgumentError({
    operation,
    field,
    message: formatUnknownError(cause),
    cause: Option.some(cause)
  })

const mapTransportError = (error: unknown, operation: string): TransportError => {
  if (error instanceof FrameTooLargeError) {
    return new TransportFrameTooLargeError({ operation, size: error.size, max: error.max })
  }

  if (error instanceof FrameTruncatedError) {
    return new TransportFrameTruncatedError({
      operation,
      stage: error.stage,
      expected: error.expected,
      read: error.read
    })
  }

  if (error instanceof JsonRpcFrameTruncatedError) {
    return new TransportFrameTruncatedError({
      operation,
      stage: error.stage,
      expected: error.expected,
      read: error.read
    })
  }

  if (error instanceof JsonRpcFrameHeaderError) {
    return invalidArgument(operation, "header", error)
  }

  if (error instanceof InvalidFrameLimitError) {
    return invalidArgument(operation, "maxFrameBytes", error)
  }

  return new TransportWriteError({ operation, cause: Option.some(error) })
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
