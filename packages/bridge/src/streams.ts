import { Cause, Effect, Exit, Fiber, Option, Queue, Schema, Stream } from "effect"

import {
  type ApiContractClass,
  type ApiContractSpec,
  type ApiLayer,
  type ApiMethodSpec,
  type ApiStreamSpec,
  type BackpressureSpec,
  isStreamSpec
} from "./contracts.js"
import {
  HostProtocolBackpressureOverflowError,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolInternalError,
  HostProtocolRequestEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type HostProtocolError
} from "./protocol.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
const DEFAULT_STREAM_QUEUE_SIZE = 1_024

export type HostProtocolStreamEnvelope = HostProtocolStreamByRequestEnvelope

export class ApiStreamDataFrame extends Schema.Class<ApiStreamDataFrame>("ApiStreamDataFrame")({
  type: Schema.Literal("data"),
  chunk: Schema.Unknown
}) {}

export class ApiStreamErrorFrame extends Schema.Class<ApiStreamErrorFrame>("ApiStreamErrorFrame")({
  type: Schema.Literal("error"),
  error: Schema.Unknown
}) {}

export class ApiStreamCompleteFrame extends Schema.Class<ApiStreamCompleteFrame>(
  "ApiStreamCompleteFrame"
)({
  type: Schema.Literal("complete")
}) {}

export class ApiStreamClosedFrame extends Schema.Class<ApiStreamClosedFrame>(
  "ApiStreamClosedFrame"
)({
  type: Schema.Literal("closed")
}) {}

export const ApiStreamFrame = Schema.Union([
  ApiStreamDataFrame,
  ApiStreamErrorFrame,
  ApiStreamCompleteFrame,
  ApiStreamClosedFrame
])

export type ApiStreamFrame = typeof ApiStreamFrame.Type

export interface ApiStreamRuntime<Env = never> {
  readonly stream: (
    request: HostProtocolRequestEnvelope
  ) => Stream.Stream<HostProtocolStreamEnvelope, HostProtocolError, Env>
}

export interface ApiStreamRuntimeOptions {
  readonly now?: () => number
  readonly nextStreamId?: () => string
  readonly cleanupGraceMs?: number
  readonly registry?: BridgeStreamRegistry
}

interface ResolvedApiStreamRuntimeOptions {
  readonly now: () => number
  readonly nextStreamId: () => string
  readonly cleanupGraceMs: number
  readonly registry: BridgeStreamRegistry
}

export type ApiStreamLayerEnvironment<Layer> =
  Layer extends ApiLayer<string, infer Spec, infer Handlers>
    ? {
        readonly [Method in keyof Spec]: HandlerEnvironment<Handlers[Method]>
      }[keyof Spec]
    : never

type HandlerEnvironment<Handler> = Handler extends (
  ...args: infer _Args
) => Stream.Stream<unknown, unknown, infer Env>
  ? Env
  : never

type AnyApiLayer = {
  readonly contract: ApiContractClass<string, ApiContractSpec>
  readonly handlers: object
}

type BoundStream = {
  readonly spec: ApiMethodSpec & { readonly output: ApiStreamSpec }
  readonly handler: (input: unknown) => Stream.Stream<unknown, unknown, unknown>
}

type StreamQueue = {
  readonly queue: Queue.Queue<HostProtocolStreamEnvelope, Cause.Done>
  readonly overflow: NonNullable<BackpressureSpec["overflow"]>
}

export type ApiStreamTerminalType = "complete" | "error" | "closed"

export interface BridgeStreamRegistryEntry {
  readonly streamId: string
  readonly generation: number
  readonly state: "open" | "terminal"
  readonly terminal?: ApiStreamTerminalType
  readonly terminalAt?: number
}

export interface BridgeStreamRegistry {
  readonly register: (streamId: string) => Effect.Effect<BridgeStreamRegistryEntry, never, never>
  readonly terminate: (
    streamId: string,
    terminal: ApiStreamTerminalType,
    now: number
  ) => Effect.Effect<boolean, never, never>
  readonly isTerminal: (streamId: string) => Effect.Effect<boolean, never, never>
  readonly gcExpired: (now: number) => Effect.Effect<number, never, never>
  readonly snapshot: () => Effect.Effect<ReadonlyArray<BridgeStreamRegistryEntry>, never, never>
}

export const makeBridgeStreamRegistry = (cleanupGraceMs = 30_000): BridgeStreamRegistry => {
  const entries = new Map<string, BridgeStreamRegistryEntry>()
  const generations = new Map<string, number>()

  const registry: BridgeStreamRegistry = {
    register: (streamId) =>
      Effect.sync(() => {
        const previousGeneration = generations.get(streamId)
        const generation = previousGeneration === undefined ? 0 : previousGeneration + 1
        const entry = { streamId, generation, state: "open" } satisfies BridgeStreamRegistryEntry
        entries.set(streamId, entry)
        generations.set(streamId, generation)
        return entry
      }),
    terminate: (streamId, terminal, now) =>
      Effect.sync(() => {
        const current = entries.get(streamId)
        if (current?.state === "terminal") {
          return false
        }
        entries.set(streamId, {
          generation: current?.generation ?? 0,
          state: "terminal",
          streamId,
          terminal,
          terminalAt: now
        })
        generations.set(streamId, current?.generation ?? 0)
        return true
      }),
    isTerminal: (streamId) => Effect.sync(() => entries.get(streamId)?.state === "terminal"),
    gcExpired: (now) =>
      Effect.sync(() => {
        let removed = 0
        for (const [streamId, entry] of entries) {
          if (
            entry.state === "terminal" &&
            entry.terminalAt !== undefined &&
            now - entry.terminalAt >= cleanupGraceMs
          ) {
            entries.delete(streamId)
            removed += 1
          }
        }
        return removed
      }),
    snapshot: () => Effect.sync(() => Array.from(entries.values()))
  }

  return Object.freeze(registry)
}

const makeStreams = <Layers extends readonly AnyApiLayer[]>(
  ...layers: Layers
): ApiStreamRuntime<ApiStreamLayerEnvironment<Layers[number]>> =>
  makeStreamsWithOptions({}, ...layers)

const makeStreamsWithOptions = <Layers extends readonly AnyApiLayer[]>(
  options: ApiStreamRuntimeOptions,
  ...layers: Layers
): ApiStreamRuntime<ApiStreamLayerEnvironment<Layers[number]>> => {
  const table = new Map<string, BoundStream>()
  const resolved = resolveOptions(options)

  for (const layer of layers) {
    for (const [method, spec] of Object.entries(layer.contract.spec)) {
      if (!isStreamSpec(spec.output)) {
        continue
      }

      const operation = methodName(layer.contract.tag, method)
      const handler = Reflect.get(layer.handlers, method) as (
        this: object,
        input: unknown
      ) => Stream.Stream<unknown, unknown, unknown>

      table.set(operation, {
        spec: {
          ...spec,
          output: spec.output
        },
        handler: (input) => handler.call(layer.handlers, input)
      })
    }
  }

  return Object.freeze({
    stream: (request: HostProtocolRequestEnvelope) =>
      streamDispatch(table, resolved, request) as Stream.Stream<
        HostProtocolStreamEnvelope,
        HostProtocolError,
        ApiStreamLayerEnvironment<Layers[number]>
      >
  }) as ApiStreamRuntime<ApiStreamLayerEnvironment<Layers[number]>>
}

export const Streams = Object.assign(makeStreams, {
  withOptions: makeStreamsWithOptions
})

const streamDispatch = (
  table: ReadonlyMap<string, BoundStream>,
  options: ResolvedApiStreamRuntimeOptions,
  request: HostProtocolRequestEnvelope
): Stream.Stream<HostProtocolStreamEnvelope, HostProtocolError, unknown> => {
  const bound = table.get(request.method)

  if (bound === undefined) {
    return Stream.fail(
      makeHostProtocolInvalidArgumentError("method", "unknown stream", request.method)
    )
  }

  return Stream.unwrap(
    Effect.gen(function* () {
      const input = yield* decodeInput(request.method, bound.spec, request.payload)
      yield* options.registry.gcExpired(options.now())
      const streamId = options.nextStreamId()
      yield* options.registry.register(streamId)
      const queue = yield* makeStreamQueue(bound.spec)
      const producer = runProducer(request, streamId, bound, queue, options, bound.handler(input))

      const fiber = yield* Effect.forkScoped(producer)

      return Stream.fromQueue(queue.queue).pipe(Stream.ensuring(Fiber.interrupt(fiber)))
    })
  )
}

const runProducer = (
  request: HostProtocolRequestEnvelope,
  streamId: string,
  bound: BoundStream,
  streamQueue: StreamQueue,
  options: ResolvedApiStreamRuntimeOptions,
  source: Stream.Stream<unknown, unknown, unknown>
): Effect.Effect<void, never, unknown> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      source.pipe(
        Stream.mapEffect((chunk) =>
          encodeChunkFrame(request, streamId, bound.spec.output, chunk, options)
        ),
        Stream.runForEach((frame) => offerStreamFrame(request.method, streamQueue, frame, options))
      )
    )

    if (Exit.isFailure(exit)) {
      yield* offerTerminalFrame(
        streamQueue,
        yield* encodeErrorFrame(request, streamId, bound.spec.output, exit.cause, options),
        options,
        "error"
      )
    } else {
      yield* offerTerminalFrame(
        streamQueue,
        completeFrame(request, streamId, options),
        options,
        "complete"
      )
    }

    yield* Queue.end(streamQueue.queue)
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        yield* offerTerminalFrame(
          streamQueue,
          protocolErrorFrame(
            request,
            streamId,
            options,
            new HostProtocolInternalError({
              tag: "Internal",
              message: formatUnknownError(cause),
              operation: request.method,
              cause,
              recoverable: false
            })
          ),
          options,
          "error"
        )
        yield* Queue.end(streamQueue.queue)
      })
    )
  )

const makeStreamQueue = (spec: BoundStream["spec"]): Effect.Effect<StreamQueue, never, never> =>
  Effect.gen(function* () {
    const backpressure = spec.backpressure ?? spec.output.backpressure
    const capacity = backpressure?.size ?? DEFAULT_STREAM_QUEUE_SIZE
    const overflow = backpressure?.overflow ?? "error"
    const queue =
      overflow === "dropOldest"
        ? yield* Queue.sliding<HostProtocolStreamEnvelope, Cause.Done>(capacity)
        : overflow === "block"
          ? yield* Queue.bounded<HostProtocolStreamEnvelope, Cause.Done>(capacity)
          : yield* Queue.dropping<HostProtocolStreamEnvelope, Cause.Done>(capacity)

    return { queue, overflow }
  })

const offerStreamFrame = (
  operation: string,
  streamQueue: StreamQueue,
  frame: HostProtocolStreamEnvelope,
  options: ResolvedApiStreamRuntimeOptions
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.gen(function* () {
    if (frame.resourceId !== undefined && (yield* options.registry.isTerminal(frame.resourceId))) {
      return
    }

    if (streamQueue.overflow === "block") {
      yield* Queue.offer(streamQueue.queue, frame)
      return
    }

    const offered = Queue.offerUnsafe(streamQueue.queue, frame)
    if (!offered && streamQueue.overflow === "error") {
      return yield* Effect.fail(
        new HostProtocolBackpressureOverflowError({
          tag: "BackpressureOverflow",
          policy: "error",
          lostFrames: 1,
          message: "stream subscriber queue exceeded its declared capacity",
          operation,
          recoverable: true
        })
      )
    }
  })

const offerTerminalFrame = (
  streamQueue: StreamQueue,
  frame: HostProtocolStreamEnvelope,
  options: ResolvedApiStreamRuntimeOptions,
  terminal: ApiStreamTerminalType
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const streamId = frame.resourceId
    const shouldOffer =
      streamId === undefined
        ? true
        : yield* options.registry.terminate(streamId, terminal, options.now())

    if (shouldOffer) {
      yield* Effect.sync(() => {
        while (!Queue.offerUnsafe(streamQueue.queue, frame)) {
          Queue.takeUnsafe(streamQueue.queue)
        }
      })
    }
  })

const encodeChunkFrame = (
  request: HostProtocolRequestEnvelope,
  streamId: string,
  spec: ApiStreamSpec,
  chunk: unknown,
  options: ResolvedApiStreamRuntimeOptions
): Effect.Effect<HostProtocolStreamEnvelope, HostProtocolError, never> =>
  Effect.gen(function* () {
    const encodedChunk = yield* encodeStreamChunk(request.method, spec, chunk)

    return streamFrame(
      request,
      streamId,
      options,
      new ApiStreamDataFrame({ type: "data", chunk: encodedChunk })
    )
  })

const encodeErrorFrame = (
  request: HostProtocolRequestEnvelope,
  streamId: string,
  spec: ApiStreamSpec,
  cause: Cause.Cause<unknown>,
  options: ResolvedApiStreamRuntimeOptions
): Effect.Effect<HostProtocolStreamEnvelope, never, never> =>
  Effect.gen(function* () {
    const fail = cause.reasons.find(Cause.isFailReason)
    const error = fail === undefined ? formatUnknownError(cause) : fail.error
    const protocolError = yield* Effect.option(decodeHostProtocolError(error))
    if (Option.isSome(protocolError)) {
      return protocolErrorFrame(request, streamId, options, protocolError.value)
    }

    const encoded = yield* encodeStreamError(request.method, spec, error).pipe(
      Effect.catch((hostProtocolError: HostProtocolError) =>
        Effect.succeed(protocolErrorFrame(request, streamId, options, hostProtocolError))
      )
    )

    if (encoded instanceof HostProtocolStreamByRequestEnvelope) {
      return encoded
    }

    return streamFrame(
      request,
      streamId,
      options,
      new ApiStreamErrorFrame({ type: "error", error: encoded })
    )
  })

const completeFrame = (
  request: HostProtocolRequestEnvelope,
  streamId: string,
  options: ResolvedApiStreamRuntimeOptions
): HostProtocolStreamEnvelope =>
  streamFrame(request, streamId, options, new ApiStreamCompleteFrame({ type: "complete" }))

const streamFrame = (
  request: HostProtocolRequestEnvelope,
  streamId: string,
  options: ResolvedApiStreamRuntimeOptions,
  frame: ApiStreamFrame
): HostProtocolStreamEnvelope =>
  new HostProtocolStreamByRequestEnvelope({
    kind: "stream",
    id: request.id,
    resourceId: streamId,
    timestamp: options.now(),
    traceId: request.traceId,
    payload: frame
  })

const protocolErrorFrame = (
  request: HostProtocolRequestEnvelope,
  streamId: string,
  options: ResolvedApiStreamRuntimeOptions,
  error: HostProtocolError
): HostProtocolStreamEnvelope =>
  new HostProtocolStreamByRequestEnvelope({
    kind: "stream",
    id: request.id,
    resourceId: streamId,
    timestamp: options.now(),
    traceId: request.traceId,
    error
  })

const decodeHostProtocolError = (
  error: unknown
): Effect.Effect<HostProtocolError, unknown, never> =>
  Schema.decodeUnknownEffect(HostProtocolErrorSchema)(error, StrictParseOptions) as Effect.Effect<
    HostProtocolError,
    unknown,
    never
  >

const decodeInput = (
  operation: string,
  spec: ApiMethodSpec,
  payload: unknown
): Effect.Effect<unknown, HostProtocolError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(spec.input)(payload, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

const encodeStreamChunk = (
  operation: string,
  spec: ApiStreamSpec,
  chunk: unknown
): Effect.Effect<unknown, HostProtocolError, never> =>
  Effect.mapError(
    Schema.encodeEffect(spec.chunk)(chunk, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  )

const encodeStreamError = (
  operation: string,
  spec: ApiStreamSpec,
  error: unknown
): Effect.Effect<unknown, HostProtocolError, never> =>
  Effect.mapError(
    Schema.encodeEffect(spec.error)(error, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (schemaError) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(schemaError))
  )

const resolveOptions = (options: ApiStreamRuntimeOptions): ResolvedApiStreamRuntimeOptions => ({
  cleanupGraceMs: options.cleanupGraceMs ?? 30_000,
  now: options.now ?? Date.now,
  nextStreamId: options.nextStreamId ?? (() => `stream-${globalThis.crypto.randomUUID()}`),
  registry: options.registry ?? makeBridgeStreamRegistry(options.cleanupGraceMs)
})

const methodName = (tag: string, method: string): string => `${tag}.${method}`

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
