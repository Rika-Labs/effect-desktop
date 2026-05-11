import { Cause, Effect, Exit, Fiber, Option, Queue, Ref, Schema, Stream } from "effect"

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
  HostProtocolCancelByRequestEnvelope,
  HostProtocolCancelByResourceEnvelope,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolInternalError,
  HostProtocolRequestEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  validateHostProtocolTimestamp,
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
  readonly cancel: (
    request: HostProtocolCancelByRequestEnvelope | HostProtocolCancelByResourceEnvelope
  ) => Effect.Effect<void, never, never>
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
  readonly capacity: number
  readonly evictedFrames: Ref.Ref<number>
  readonly overflow: NonNullable<BackpressureSpec["overflow"]>
  readonly queue: Queue.Queue<HostProtocolStreamEnvelope, HostProtocolError | Cause.Done>
}

type ActiveStream = {
  readonly interrupt: Effect.Effect<void, never, never>
  readonly options: ResolvedApiStreamRuntimeOptions
  readonly queue: StreamQueue
  readonly request: HostProtocolRequestEnvelope
  readonly streamId: string
}

export type ApiStreamTerminalType = "complete" | "error" | "closed"

export interface BridgeStreamRegistryEntry {
  readonly streamId: string
  readonly generation: number
  readonly state: "open" | "terminal"
  readonly terminal?: ApiStreamTerminalType
  readonly terminalAt?: number
  readonly backpressure?: BridgeStreamBackpressureMetrics
}

export interface BridgeStreamBackpressureMetrics {
  readonly evictedFrames: number
  readonly overflow: NonNullable<BackpressureSpec["overflow"]>
  readonly queueCapacity: number
  readonly queueDepth: number
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
  readonly updateBackpressure: (
    streamId: string,
    metrics: BridgeStreamBackpressureMetrics
  ) => Effect.Effect<void, never, never>
  readonly snapshot: () => Effect.Effect<ReadonlyArray<BridgeStreamRegistryEntry>, never, never>
  readonly observe: () => Stream.Stream<ReadonlyArray<BridgeStreamRegistryEntry>, never, never>
}

export const makeBridgeStreamRegistry = (cleanupGraceMs = 30_000): BridgeStreamRegistry => {
  const entries = new Map<string, BridgeStreamRegistryEntry>()
  const generations = new Map<string, number>()
  const observers = new Set<Queue.Enqueue<ReadonlyArray<BridgeStreamRegistryEntry>, never>>()
  const snapshot = (): ReadonlyArray<BridgeStreamRegistryEntry> => Array.from(entries.values())
  const publish = (): void => {
    const current = snapshot()
    for (const observer of observers) {
      Queue.offerUnsafe(observer, current)
    }
  }

  const registry: BridgeStreamRegistry = {
    register: (streamId) =>
      Effect.sync(() => {
        const previousGeneration = generations.get(streamId)
        const generation = previousGeneration === undefined ? 0 : previousGeneration + 1
        const entry = { streamId, generation, state: "open" } satisfies BridgeStreamRegistryEntry
        entries.set(streamId, entry)
        generations.set(streamId, generation)
        publish()
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
        publish()
        return true
      }),
    isTerminal: (streamId) => Effect.sync(() => entries.get(streamId)?.state === "terminal"),
    updateBackpressure: (streamId, metrics) =>
      Effect.sync(() => {
        const current = entries.get(streamId)
        if (current === undefined) {
          return
        }
        entries.set(streamId, {
          ...current,
          backpressure: metrics
        })
        publish()
      }),
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
        if (removed > 0) {
          publish()
        }
        return removed
      }),
    snapshot: () => Effect.sync(snapshot),
    observe: () =>
      Stream.callback((queue) =>
        Effect.sync(() => {
          observers.add(queue)
          Queue.offerUnsafe(queue, snapshot())
        }).pipe(
          Effect.andThen(
            Effect.addFinalizer(() =>
              Effect.sync(() => {
                observers.delete(queue)
              })
            )
          )
        )
      )
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
  const active = new Map<string, ActiveStream>()
  const activeByResource = new Map<string, ActiveStream>()
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

  const runtime: ApiStreamRuntime<ApiStreamLayerEnvironment<Layers[number]>> = {
    stream: (request: HostProtocolRequestEnvelope) =>
      streamDispatch(table, active, activeByResource, resolved, request) as Stream.Stream<
        HostProtocolStreamEnvelope,
        HostProtocolError,
        ApiStreamLayerEnvironment<Layers[number]>
      >,
    cancel: (request) => cancelStream(active, activeByResource, request)
  }

  return Object.freeze(runtime)
}

export const Streams = Object.assign(makeStreams, {
  withOptions: makeStreamsWithOptions
})

const streamDispatch = (
  table: ReadonlyMap<string, BoundStream>,
  active: Map<string, ActiveStream>,
  activeByResource: Map<string, ActiveStream>,
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
      if (active.has(request.id)) {
        return Stream.fail(
          makeHostProtocolInvalidArgumentError("id", "request already active", request.id)
        )
      }

      yield* options.registry.gcExpired(options.now())
      const streamId = options.nextStreamId()
      yield* options.registry.register(streamId)
      const queue = yield* makeStreamQueue(bound.spec)
      yield* syncBackpressureMetrics(options.registry, streamId, queue)
      const producer = runProducer(request, streamId, bound, queue, options, bound.handler(input))

      const fiber = yield* Effect.forkScoped(producer)
      const interrupt = Effect.gen(function* () {
        yield* Fiber.interrupt(fiber)
        yield* Effect.exit(Fiber.join(fiber))
      })
      const stream = { interrupt, options, queue, request, streamId }
      active.set(request.id, stream)
      activeByResource.set(streamId, stream)

      return Stream.fromQueue(queue.queue).pipe(
        Stream.tap(() => syncBackpressureMetrics(options.registry, streamId, queue)),
        Stream.ensuring(
          Effect.gen(function* () {
            yield* interrupt
            yield* Effect.sync(() => {
              active.delete(request.id)
              activeByResource.delete(streamId)
            })
          })
        )
      )
    })
  )
}

const cancelStream = (
  active: Map<string, ActiveStream>,
  activeByResource: Map<string, ActiveStream>,
  request: HostProtocolCancelByRequestEnvelope | HostProtocolCancelByResourceEnvelope
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const streamByRequest = request.id === undefined ? undefined : active.get(request.id)
    const streamByResource =
      request.resourceId === undefined ? undefined : activeByResource.get(request.resourceId)
    const stream =
      streamByRequest ??
      streamByResource ??
      Array.from(active.values()).find(
        (activeStream) =>
          activeStream.streamId === request.resourceId ||
          activeStream.request.id === request.resourceId
      )

    if (stream === undefined) {
      return
    }

    const frame = yield* Effect.option(closedFrame(stream.request, stream.streamId, stream.options))
    if (Option.isNone(frame)) {
      return
    }
    yield* offerTerminalFrame(stream.queue, frame.value, stream.options, "closed")
    yield* Queue.end(stream.queue.queue)
    yield* stream.interrupt
    yield* Effect.sync(() => {
      active.delete(stream.request.id)
      activeByResource.delete(stream.streamId)
    })
  })

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
      const frameExit = yield* Effect.exit(
        encodeErrorFrame(request, streamId, bound.spec.output, exit.cause, options)
      )
      if (Exit.isFailure(frameExit)) {
        const fail = frameExit.cause.reasons.find(Cause.isFailReason)
        if (fail !== undefined) {
          yield* Queue.fail(streamQueue.queue, fail.error).pipe(Effect.catch(() => Effect.void))
        }
      } else {
        yield* offerTerminalFrame(streamQueue, frameExit.value, options, "error")
      }
    } else {
      const frameExit = yield* Effect.exit(completeFrame(request, streamId, options))
      if (Exit.isFailure(frameExit)) {
        const fail = frameExit.cause.reasons.find(Cause.isFailReason)
        if (fail !== undefined) {
          yield* Queue.fail(streamQueue.queue, fail.error).pipe(Effect.catch(() => Effect.void))
        }
      } else {
        yield* offerTerminalFrame(streamQueue, frameExit.value, options, "complete")
      }
    }

    yield* Queue.end(streamQueue.queue)
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        const frame = yield* Effect.exit(
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
          )
        )
        if (Exit.isFailure(frame)) {
          const fail = frame.cause.reasons.find(Cause.isFailReason)
          if (fail !== undefined) {
            yield* Queue.fail(streamQueue.queue, fail.error).pipe(Effect.catch(() => Effect.void))
          }
        } else {
          yield* offerTerminalFrame(streamQueue, frame.value, options, "error")
        }
        yield* Queue.end(streamQueue.queue)
      })
    )
  )

const makeStreamQueue = (spec: BoundStream["spec"]): Effect.Effect<StreamQueue, never, never> =>
  Effect.gen(function* () {
    const backpressure = spec.backpressure ?? spec.output.backpressure
    const capacity = backpressure?.size ?? DEFAULT_STREAM_QUEUE_SIZE
    const overflow = backpressure?.overflow ?? "error"
    const evictedFrames = yield* Ref.make(0)
    const queue =
      overflow === "dropOldest"
        ? yield* Queue.sliding<HostProtocolStreamEnvelope, HostProtocolError | Cause.Done>(capacity)
        : overflow === "block"
          ? yield* Queue.bounded<HostProtocolStreamEnvelope, HostProtocolError | Cause.Done>(
              capacity
            )
          : yield* Queue.dropping<HostProtocolStreamEnvelope, HostProtocolError | Cause.Done>(
              capacity
            )

    return { capacity, evictedFrames, overflow, queue }
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
      yield* syncBackpressureMetrics(options.registry, frame.resourceId, streamQueue)
      return
    }

    const wasFull = Queue.isFullUnsafe(streamQueue.queue)
    const offered = Queue.offerUnsafe(streamQueue.queue, frame)
    if (offered && wasFull && streamQueue.overflow === "dropOldest") {
      yield* Ref.update(streamQueue.evictedFrames, (count) => count + 1)
    }

    if (!offered) {
      yield* Ref.update(streamQueue.evictedFrames, (count) => count + 1)
    }

    yield* syncBackpressureMetrics(options.registry, frame.resourceId, streamQueue)

    if (!offered && streamQueue.overflow === "error") {
      const lostFrames = yield* Ref.get(streamQueue.evictedFrames)
      return yield* Effect.fail(
        new HostProtocolBackpressureOverflowError({
          tag: "BackpressureOverflow",
          policy: "error",
          lostFrames,
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
      const terminalEvictions = yield* Effect.sync(() => {
        let evictions = 0
        while (!Queue.offerUnsafe(streamQueue.queue, frame)) {
          Queue.takeUnsafe(streamQueue.queue)
          evictions += 1
        }
        return evictions
      })
      if (terminalEvictions > 0) {
        yield* Ref.update(streamQueue.evictedFrames, (count) => count + terminalEvictions)
      }
      yield* syncBackpressureMetrics(options.registry, streamId, streamQueue)
    }
  })

const syncBackpressureMetrics = (
  registry: BridgeStreamRegistry,
  streamId: string | undefined,
  streamQueue: StreamQueue
): Effect.Effect<void, never, never> =>
  streamId === undefined
    ? Effect.void
    : Effect.gen(function* () {
        const evictedFrames = yield* Ref.get(streamQueue.evictedFrames)
        const queueDepth = yield* Queue.size(streamQueue.queue)
        yield* registry.updateBackpressure(streamId, {
          evictedFrames,
          overflow: streamQueue.overflow,
          queueCapacity: streamQueue.capacity,
          queueDepth
        })
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

    return yield* streamFrame(
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
): Effect.Effect<HostProtocolStreamEnvelope, HostProtocolError, never> =>
  Effect.gen(function* () {
    const fail = cause.reasons.find(Cause.isFailReason)
    const error = fail === undefined ? formatUnknownError(cause) : fail.error
    const protocolError = yield* Effect.option(decodeHostProtocolError(error))
    if (Option.isSome(protocolError)) {
      return yield* protocolErrorFrame(request, streamId, options, protocolError.value)
    }

    const encoded = yield* encodeStreamError(request.method, spec, error).pipe(
      Effect.catch((hostProtocolError: HostProtocolError) =>
        protocolErrorFrame(request, streamId, options, hostProtocolError)
      )
    )

    if (encoded instanceof HostProtocolStreamByRequestEnvelope) {
      return encoded
    }

    return yield* streamFrame(
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
): Effect.Effect<HostProtocolStreamEnvelope, HostProtocolError, never> =>
  streamFrame(request, streamId, options, new ApiStreamCompleteFrame({ type: "complete" }))

const closedFrame = (
  request: HostProtocolRequestEnvelope,
  streamId: string,
  options: ResolvedApiStreamRuntimeOptions
): Effect.Effect<HostProtocolStreamEnvelope, HostProtocolError, never> =>
  streamFrame(request, streamId, options, new ApiStreamClosedFrame({ type: "closed" }))

const streamFrame = (
  request: HostProtocolRequestEnvelope,
  streamId: string,
  options: ResolvedApiStreamRuntimeOptions,
  frame: ApiStreamFrame
): Effect.Effect<HostProtocolStreamEnvelope, HostProtocolError, never> =>
  Effect.gen(function* () {
    const timestamp = yield* validateHostProtocolTimestamp(options.now(), request.method)

    return new HostProtocolStreamByRequestEnvelope({
      kind: "stream",
      id: request.id,
      resourceId: streamId,
      timestamp,
      traceId: request.traceId,
      payload: frame
    })
  })

const protocolErrorFrame = (
  request: HostProtocolRequestEnvelope,
  streamId: string,
  options: ResolvedApiStreamRuntimeOptions,
  error: HostProtocolError
): Effect.Effect<HostProtocolStreamEnvelope, HostProtocolError, never> =>
  Effect.gen(function* () {
    const timestamp = yield* validateHostProtocolTimestamp(options.now(), request.method)

    return new HostProtocolStreamByRequestEnvelope({
      kind: "stream",
      id: request.id,
      resourceId: streamId,
      timestamp,
      traceId: request.traceId,
      error
    })
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
