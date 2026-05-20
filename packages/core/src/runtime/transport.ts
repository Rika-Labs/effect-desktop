import { BridgeInspectorEvent, type BridgeInspector } from "@effect-desktop/bridge"
import {
  Cause,
  Clock,
  Context,
  Data,
  Deferred,
  Effect,
  Fiber,
  Option,
  Queue,
  Schema,
  Scope,
  Stream
} from "effect"
import { Socket } from "effect/unstable/socket"

export const MAX_FRAME_BYTES = 4 * 1024 * 1024
const DEFAULT_IN_MEMORY_TRANSPORT_QUEUE_CAPACITY = 16
const DEFAULT_UNFRAME_STREAM_QUEUE_CAPACITY = 16

const LENGTH_PREFIX_BYTES = 4
const U32_MAX = 0xffff_ffff
const TEXT_ENCODER = new TextEncoder()
const UTF8_TEXT_DECODER = new TextDecoder("utf-8", { fatal: true })
const JSON_RPC_HEADER_END = "\r\n\r\n"
const JSON_RPC_HEADER_END_BYTES = new TextEncoder().encode(JSON_RPC_HEADER_END)
const JSON_RPC_HEADER_END_BYTE_LENGTH = JSON_RPC_HEADER_END_BYTES.byteLength
const DECIMAL_CONTENT_LENGTH = /^[0-9]+$/

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

export class TransportReadError extends Data.TaggedError("TransportReadFailed")<{
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
  | TransportReadError
  | TransportCloseError

export interface TransportConnection {
  readonly send: (payload: Uint8Array) => Effect.Effect<void, TransportError, never>
  readonly receive: Stream.Stream<Uint8Array, TransportError, never>
  readonly close: () => Effect.Effect<void, TransportError, never>
}

export interface InstrumentTransportConnectionOptions {
  readonly inspector?: BridgeInspector
  readonly target: string
  readonly now?: () => number
}

export interface TransportUnframeStreamInput {
  readonly scheme: TransportScheme
  readonly chunks: Stream.Stream<Uint8Array, TransportError, never>
  readonly maxFrameBytes?: number
  readonly frameQueueCapacity?: number
}

export interface InMemoryTransportPairOptions {
  readonly queueCapacity?: number
}

export interface TransportApi {
  readonly frame: (input: unknown) => Effect.Effect<Uint8Array, TransportError, never>
  readonly unframe: (input: unknown) => Effect.Effect<readonly Uint8Array[], TransportError, never>
  readonly unframeStream: (input: unknown) => Stream.Stream<Uint8Array, TransportError, never>
  readonly connect: (
    input: unknown
  ) => Effect.Effect<TransportConnection, TransportError, Socket.Socket | Scope.Scope>
}

export class FrameTooLargeError extends Data.TaggedError("FrameTooLargeError")<{
  readonly size: number
  readonly max: number
}> {}

export class FrameTruncatedError extends Data.TaggedError("FrameTruncatedError")<{
  readonly stage: "length" | "body"
  readonly expected: number
  readonly read: number
}> {}

export class InvalidFrameLimitError extends Data.TaggedError("InvalidFrameLimitError")<{
  readonly maxFrameBytes: number
}> {}

export interface FrameCodecOptions {
  readonly maxFrameBytes?: number
}

const transportFrame = Effect.fn("Transport.frame")(function* (input: unknown) {
  const decoded = yield* decodeFrameInput(input, "Transport.frame")
  return yield* framePayload(decoded.scheme, decoded.payload, decoded, "Transport.frame")
})

const transportUnframe = Effect.fn("Transport.unframe")(function* (input: unknown) {
  const decoded = yield* decodeUnframeInput(input, "Transport.unframe")
  return yield* unframeBytes(decoded.scheme, decoded.bytes, decoded, "Transport.unframe")
})

const transportConnect = Effect.fn("Transport.connect")(function* (input: unknown) {
  const decoded = yield* decodeConnectInput(input, "Transport.connect")
  const socket = yield* Socket.Socket.asEffect()
  return yield* makeFramedSocketConnection(socket, decoded, "Transport.connect")
})

export const makeTransport = (): Effect.Effect<TransportApi, never, never> =>
  Effect.sync(() =>
    Object.freeze({
      frame: transportFrame,
      unframe: transportUnframe,
      unframeStream: (input: unknown) =>
        makeUnframeStream(input).pipe(Stream.withSpan("Transport.unframeStream")),
      connect: transportConnect
    })
  )

export class Transport extends Context.Service<Transport, TransportApi>()(
  "@effect-desktop/core/runtime/transport",
  {
    make: makeTransport()
  }
) {}

export const instrumentTransportConnection = (
  connection: TransportConnection,
  options: InstrumentTransportConnectionOptions
): TransportConnection =>
  Object.freeze({
    send: (payload: Uint8Array) =>
      connection.send(payload).pipe(
        Effect.tap(() =>
          emitTransportEvent(
            options.inspector,
            "transport.backpressure",
            options.target,
            options.now,
            {
              bytes: payload.byteLength
            }
          )
        )
      ),
    receive: connection.receive.pipe(
      Stream.tap((payload) =>
        emitTransportEvent(options.inspector, "transport.connect", options.target, options.now, {
          bytes: payload.byteLength
        })
      ),
      Stream.tapError((error) =>
        emitTransportEvent(options.inspector, "transport.disconnect", options.target, options.now, {
          errorTag: transportErrorTag(error)
        })
      )
    ),
    close: () =>
      connection
        .close()
        .pipe(
          Effect.ensuring(
            emitTransportEvent(
              options.inspector,
              "transport.disconnect",
              options.target,
              options.now,
              {}
            )
          )
        )
  })

const emitTransportEvent = (
  inspector: BridgeInspector | undefined,
  kind: "transport.connect" | "transport.backpressure" | "transport.disconnect",
  target: string,
  now: (() => number) | undefined,
  details: { readonly bytes?: number; readonly errorTag?: string | undefined }
): Effect.Effect<void, never, never> =>
  inspector === undefined
    ? Effect.void
    : currentTimeMillis(now).pipe(
        Effect.flatMap((timestamp) =>
          inspector.emit(
            new BridgeInspectorEvent({
              kind,
              boundary: "host",
              direction: kind === "transport.backpressure" ? "outbound" : "inbound",
              method: target,
              timestamp,
              frameKind: "transport",
              errorTag: details.errorTag,
              payload: details.bytes === undefined ? undefined : { bytes: details.bytes }
            })
          )
        )
      )

const currentTimeMillis = (now: (() => number) | undefined): Effect.Effect<number, never, never> =>
  now === undefined ? Clock.currentTimeMillis : Effect.sync(now)

const transportErrorTag = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null
    ? "_tag" in error
      ? String(Reflect.get(error, "_tag"))
      : "tag" in error
        ? String(Reflect.get(error, "tag"))
        : undefined
    : undefined

export const encodeFrame = (payload: Uint8Array, options: FrameCodecOptions = {}): Uint8Array => {
  const maxFrameBytes = resolveMaxFrameBytes(options)
  if (payload.byteLength > maxFrameBytes) {
    throw new FrameTooLargeError({ size: payload.byteLength, max: maxFrameBytes })
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

  constructor(options: FrameCodecOptions = {}) {
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
          throw new FrameTooLargeError({ size: length, max: this.#maxFrameBytes })
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

      throw new FrameTruncatedError({
        stage: "length",
        expected: LENGTH_PREFIX_BYTES,
        read: this.#bufferedBytes
      })
    }

    throw new FrameTruncatedError({
      stage: "body",
      expected: this.#expectedBodyBytes,
      read: this.#bufferedBytes
    })
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

export const makeFramedSocketConnection = (
  socket: Socket.Socket,
  options: FrameCodecOptions = {},
  operation = "Transport.socket"
): Effect.Effect<TransportConnection, TransportError, Scope.Scope> =>
  Effect.gen(function* () {
    const write = yield* socket.writer
    const opened = yield* Deferred.make<void, TransportError>()
    const queue = yield* Queue.bounded<Uint8Array, TransportError | Cause.Done>(
      DEFAULT_UNFRAME_STREAM_QUEUE_CAPACITY
    )
    const receiveOperation = `${operation}.receive`
    const decoder = makeLengthPrefixedStreamingDecoder(options, receiveOperation)
    let closed = false
    const finishAndEndQueue = Effect.gen(function* () {
      const frames = yield* decoder.finish()
      for (const frame of frames) {
        yield* Queue.offer(queue, frame)
      }
      yield* Deferred.complete(
        opened,
        Effect.fail(new TransportClosedError({ operation: receiveOperation }))
      )
      yield* Queue.end(queue)
    }).pipe(
      Effect.tapError((error: TransportError) => failOpenAndQueue(opened, queue, error)),
      Effect.ignore
    )

    const reader = yield* socket
      .run<void, TransportError, never>(
        (chunk) =>
          decoder
            .push(chunk)
            .pipe(
              Effect.flatMap((frames) =>
                Effect.forEach(frames, (frame) => Queue.offer(queue, frame), { discard: true })
              )
            ),
        { onOpen: Deferred.succeed(opened, undefined).pipe(Effect.asVoid) }
      )
      .pipe(
        Effect.andThen(finishAndEndQueue),
        Effect.catch((error: Socket.SocketError | TransportError) =>
          isCleanSocketClose(error)
            ? finishAndEndQueue
            : failOpenAndQueue(opened, queue, mapSocketReadError(error, receiveOperation))
        ),
        Effect.forkScoped
      )

    yield* Deferred.await(opened)

    return Object.freeze({
      send: (payload: Uint8Array) =>
        Effect.gen(function* () {
          if (closed) {
            return yield* new TransportClosedError({ operation: `${operation}.send` })
          }
          const frame = yield* framePayload(
            "length-prefixed",
            payload,
            options,
            `${operation}.send`
          )
          yield* write(frame).pipe(
            Effect.mapError((error) => mapSocketWriteError(error, `${operation}.send`))
          )
        }),
      receive: Stream.fromQueue(queue),
      close: () =>
        Effect.gen(function* () {
          if (closed) {
            return
          }
          closed = true
          yield* Queue.fail(queue, new TransportClosedError({ operation: receiveOperation }))
          yield* write(new Socket.CloseEvent(1000)).pipe(
            Effect.mapError((error) => mapSocketCloseError(error, `${operation}.close`)),
            Effect.tapErrorTag("TransportCloseFailed", () => Fiber.interrupt(reader))
          )
          yield* Fiber.interrupt(reader)
        })
    })
  })

export const makeInMemoryTransportPair = (
  options: InMemoryTransportPairOptions = {}
): Effect.Effect<readonly [TransportConnection, TransportConnection], never, never> =>
  Effect.gen(function* () {
    const queueCapacity = resolveQueueCapacity(
      options.queueCapacity,
      DEFAULT_IN_MEMORY_TRANSPORT_QUEUE_CAPACITY
    )
    const leftInbound = yield* Queue.bounded<Uint8Array, TransportError>(queueCapacity)
    const rightInbound = yield* Queue.bounded<Uint8Array, TransportError>(queueCapacity)
    return [
      makeQueuedConnection(leftInbound, rightInbound, "Transport.memory.left"),
      makeQueuedConnection(rightInbound, leftInbound, "Transport.memory.right")
    ] as const
  })

const makeQueuedConnection = (
  inbound: Queue.Queue<Uint8Array, TransportError>,
  outbound: Queue.Queue<Uint8Array, TransportError>,
  operation: string
): TransportConnection => {
  let closed = false

  return Object.freeze({
    send: (payload: Uint8Array) =>
      Effect.gen(function* () {
        if (closed) {
          return yield* new TransportClosedError({ operation: `${operation}.send` })
        }
        yield* Queue.offer(outbound, payload.slice()).pipe(
          Effect.mapError(
            (error) =>
              new TransportWriteError({
                operation: `${operation}.send`,
                cause: Option.some(error)
              })
          )
        )
      }),
    receive: Stream.fromQueue(inbound),
    close: () =>
      Effect.gen(function* () {
        if (closed) {
          return
        }
        closed = true
        yield* Queue.shutdown(inbound)
        yield* Queue.shutdown(outbound)
      })
  })
}

const resolveMaxFrameBytes = (options: FrameCodecOptions): number => {
  const maxFrameBytes = options.maxFrameBytes ?? MAX_FRAME_BYTES
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 0 || maxFrameBytes > U32_MAX) {
    throw new InvalidFrameLimitError({ maxFrameBytes: maxFrameBytes })
  }

  return maxFrameBytes
}

const resolveQueueCapacity = (value: number | undefined, fallback: number): number =>
  value === undefined ? fallback : Number.isSafeInteger(value) && value > 0 ? value : fallback

const framePayload = (
  scheme: TransportScheme,
  payload: Uint8Array,
  options: FrameCodecOptions,
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
  options: FrameCodecOptions,
  operation: string
): Effect.Effect<readonly Uint8Array[], TransportError, never> =>
  Effect.try({
    try: () =>
      scheme === "length-prefixed"
        ? decodeLengthPrefixedBytes(bytes, options)
        : decodeJsonRpcFrames(bytes, options),
    catch: (error) => mapTransportError(error, operation)
  })

const makeUnframeStream = (input: unknown): Stream.Stream<Uint8Array, TransportError, never> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const decoded = yield* decodeUnframeStreamInput(input, "Transport.unframeStream")
      const queue = yield* Queue.bounded<Uint8Array, TransportError | Cause.Done>(
        resolveQueueCapacity(decoded.frameQueueCapacity, DEFAULT_UNFRAME_STREAM_QUEUE_CAPACITY)
      )
      const decoder =
        decoded.scheme === "length-prefixed"
          ? makeLengthPrefixedStreamingDecoder(decoded)
          : makeJsonRpcStreamingDecoder(decoded)
      const producer = yield* decoded.chunks.pipe(
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
        Effect.tapError((error: TransportError) => Queue.fail(queue, error)),
        Effect.ignore,
        Effect.forkScoped
      )

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
  options: FrameCodecOptions
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
  options: FrameCodecOptions,
  operation = "Transport.unframeStream"
): StreamingFrameDecoder => {
  const decoder = new FrameDecoder(options)
  return {
    push: (chunk) =>
      Effect.try({
        try: () => decoder.push(chunk),
        catch: (error) => mapTransportError(error, operation)
      }),
    finish: () =>
      Effect.try({
        try: () => {
          decoder.finish()
          return []
        },
        catch: (error) => mapTransportError(error, operation)
      })
  }
}

const makeJsonRpcStreamingDecoder = (
  options: FrameCodecOptions,
  operation = "Transport.unframeStream"
): StreamingFrameDecoder => {
  const decoder = new JsonRpcFrameDecoder(options)
  return {
    push: (chunk) =>
      Effect.try({
        try: () => decoder.push(chunk),
        catch: (error) => mapTransportError(error, operation)
      }),
    finish: () =>
      Effect.try({
        try: () => {
          decoder.finish()
          return []
        },
        catch: (error) => mapTransportError(error, operation)
      })
  }
}

const encodeJsonRpcFrame = (payload: Uint8Array, options: FrameCodecOptions = {}): Uint8Array => {
  const maxFrameBytes = resolveMaxFrameBytes(options)
  if (payload.byteLength > maxFrameBytes) {
    throw new FrameTooLargeError({ size: payload.byteLength, max: maxFrameBytes })
  }

  const header = TEXT_ENCODER.encode(`Content-Length: ${payload.byteLength}\r\n\r\n`)
  const frame = new Uint8Array(header.byteLength + payload.byteLength)
  frame.set(header, 0)
  frame.set(payload, header.byteLength)
  return frame
}

const decodeJsonRpcFrames = (
  bytes: Uint8Array,
  options: FrameCodecOptions = {}
): readonly Uint8Array[] => {
  const decoder = new JsonRpcFrameDecoder(options)
  const frames = decoder.push(bytes)
  decoder.finish()
  return frames
}

class JsonRpcFrameDecoder {
  readonly #maxFrameBytes: number
  #buffer: Uint8Array<ArrayBufferLike> = new Uint8Array()

  constructor(options: FrameCodecOptions = {}) {
    this.#maxFrameBytes = resolveMaxFrameBytes(options)
  }

  push(chunk: Uint8Array): readonly Uint8Array[] {
    this.#buffer = concatBytes(this.#buffer, chunk)
    const frames: Uint8Array[] = []

    while (this.#buffer.byteLength > 0) {
      const headerEnd = findHeaderEnd(this.#buffer)
      if (headerEnd < 0) {
        return frames
      }

      const headerText = decodeHeaderText(this.#buffer.slice(0, headerEnd))
      const contentLength = parseContentLength(headerText)
      if (contentLength > this.#maxFrameBytes) {
        throw new FrameTooLargeError({ size: contentLength, max: this.#maxFrameBytes })
      }

      const bodyOffset = headerEnd + JSON_RPC_HEADER_END_BYTE_LENGTH
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

    const headerEnd = findHeaderEnd(this.#buffer)
    if (headerEnd < 0) {
      throw new JsonRpcFrameTruncatedError({
        stage: "header",
        expected: JSON_RPC_HEADER_END.length,
        read: this.#buffer.byteLength
      })
    }

    const headerText = decodeHeaderText(this.#buffer.slice(0, headerEnd))
    const contentLength = parseContentLength(headerText)
    const bodyOffset = headerEnd + JSON_RPC_HEADER_END_BYTE_LENGTH
    throw new JsonRpcFrameTruncatedError({
      stage: "body",
      expected: contentLength,
      read: this.#buffer.byteLength - bodyOffset
    })
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
  const lines = headerText
    .split("\r\n")
    .filter((candidate) => candidate.toLowerCase().startsWith("content-length:"))
  if (lines.length !== 1) {
    throw new JsonRpcFrameHeaderError({ headerText: headerText })
  }

  const line = lines[0]
  const value = line === undefined ? undefined : line.slice("content-length:".length).trim()
  if (value === undefined || !DECIMAL_CONTENT_LENGTH.test(value)) {
    throw new JsonRpcFrameHeaderError({ headerText: headerText })
  }
  const length = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(length) || length < 0 || length > U32_MAX) {
    throw new JsonRpcFrameHeaderError({ headerText: headerText })
  }

  return length
}

const decodeHeaderText = (headerBytes: Uint8Array): string => {
  try {
    return UTF8_TEXT_DECODER.decode(headerBytes)
  } catch {
    throw new JsonRpcFrameHeaderError({ headerText: "invalid utf-8" })
  }
}

const findHeaderEnd = (bytes: Uint8Array): number => {
  for (let index = 0; index + 3 < bytes.byteLength; index += 1) {
    if (
      bytes[index] === JSON_RPC_HEADER_END_BYTES[0] &&
      bytes[index + 1] === JSON_RPC_HEADER_END_BYTES[1] &&
      bytes[index + 2] === JSON_RPC_HEADER_END_BYTES[2] &&
      bytes[index + 3] === JSON_RPC_HEADER_END_BYTES[3]
    ) {
      return index
    }
  }

  return -1
}

class JsonRpcFrameHeaderError extends Data.TaggedError("JsonRpcFrameHeaderError")<{
  readonly headerText: string
}> {}

class JsonRpcFrameTruncatedError extends Data.TaggedError("JsonRpcFrameTruncatedError")<{
  readonly stage: "header" | "body"
  readonly expected: number
  readonly read: number
}> {}

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
  input: unknown,
  operation: string
): Effect.Effect<TransportUnframeStreamInput, TransportInvalidArgumentError, never> =>
  Effect.gen(function* () {
    const fields = isRecord(input) ? input : {}
    const decoded = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        scheme: TransportScheme,
        maxFrameBytes: Schema.optionalKey(PositiveInt),
        frameQueueCapacity: Schema.optionalKey(PositiveInt)
      })
    )({
      scheme: fields["scheme"],
      ...(fields["maxFrameBytes"] === undefined ? {} : { maxFrameBytes: fields["maxFrameBytes"] }),
      ...(fields["frameQueueCapacity"] === undefined
        ? {}
        : { frameQueueCapacity: fields["frameQueueCapacity"] })
    }).pipe(Effect.mapError((error) => invalidArgument(operation, "input", error)))

    if (!isStreamLike(fields["chunks"])) {
      return yield* invalidArgument(operation, "chunks", "chunks must be an Effect Stream")
    }

    return {
      ...decoded,
      chunks: fields["chunks"]
    } satisfies TransportUnframeStreamInput
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isStreamLike = (value: unknown): value is Stream.Stream<Uint8Array, TransportError, never> =>
  typeof value === "object" && value !== null && "pipe" in value && typeof value.pipe === "function"

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

const isCleanSocketClose = (error: unknown): boolean =>
  Socket.SocketError.is(error) &&
  error.reason._tag === "SocketCloseError" &&
  error.reason.code === 1000

const isTransportError = (error: unknown): error is TransportError =>
  error instanceof TransportInvalidArgumentError ||
  error instanceof TransportFrameTooLargeError ||
  error instanceof TransportFrameTruncatedError ||
  error instanceof TransportClosedError ||
  error instanceof TransportWriteError ||
  error instanceof TransportReadError ||
  error instanceof TransportCloseError

const failOpenAndQueue = (
  opened: Deferred.Deferred<void, TransportError>,
  queue: Queue.Queue<Uint8Array, TransportError | Cause.Done>,
  error: TransportError
): Effect.Effect<void> =>
  Deferred.complete(opened, Effect.fail(error)).pipe(Effect.andThen(Queue.fail(queue, error)))

const mapSocketReadError = (error: unknown, operation: string): TransportError =>
  isTransportError(error)
    ? error
    : isCleanSocketClose(error)
      ? new TransportClosedError({ operation })
      : new TransportReadError({ operation, cause: Option.some(error) })

const mapSocketWriteError = (error: unknown, operation: string): TransportError =>
  isCleanSocketClose(error)
    ? new TransportClosedError({ operation })
    : new TransportWriteError({ operation, cause: Option.some(error) })

const mapSocketCloseError = (error: unknown, operation: string): TransportCloseError =>
  new TransportCloseError({
    operation,
    cause: Option.some(error)
  })

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
