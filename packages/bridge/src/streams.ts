import {
  Cause,
  Effect,
  Exit,
  FiberMap,
  Option,
  Queue,
  Ref,
  Schema,
  Semaphore,
  Scope,
  Stream,
  SubscriptionRef
} from "effect"

import {
  type BridgeRpcGroup,
  type BridgeRpcSpec,
  type BridgeRpcLayer,
  type BridgeRpcMethodSpec,
  type BridgeRpcCodec,
  type BridgeRpcStreamSpec,
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
  makeHostProtocolInvalidStateError,
  makeHostProtocolInvalidOutputError,
  validateHostProtocolTimestamp,
  type HostProtocolError
} from "./protocol.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
const DEFAULT_STREAM_QUEUE_SIZE = 1_024

export type HostProtocolStreamEnvelope = HostProtocolStreamByRequestEnvelope

export class BridgeStreamDataFrame extends Schema.Class<BridgeStreamDataFrame>(
  "BridgeStreamDataFrame"
)({
  type: Schema.Literal("data"),
  chunk: Schema.Unknown
}) {}

export class BridgeStreamErrorFrame extends Schema.Class<BridgeStreamErrorFrame>(
  "BridgeStreamErrorFrame"
)({
  type: Schema.Literal("error"),
  error: Schema.Unknown
}) {}

export class BridgeStreamCompleteFrame extends Schema.Class<BridgeStreamCompleteFrame>(
  "BridgeStreamCompleteFrame"
)({
  type: Schema.Literal("complete")
}) {}

export class BridgeStreamClosedFrame extends Schema.Class<BridgeStreamClosedFrame>(
  "BridgeStreamClosedFrame"
)({
  type: Schema.Literal("closed")
}) {}

export const BridgeStreamFrame = Schema.Union([
  BridgeStreamDataFrame,
  BridgeStreamErrorFrame,
  BridgeStreamCompleteFrame,
  BridgeStreamClosedFrame
])

export type BridgeStreamFrame = typeof BridgeStreamFrame.Type

export interface BridgeStreamRuntime<Env = never> {
  readonly stream: (
    request: HostProtocolRequestEnvelope
  ) => Stream.Stream<HostProtocolStreamEnvelope, HostProtocolError, Env>
  readonly cancel: (
    request: HostProtocolCancelByRequestEnvelope | HostProtocolCancelByResourceEnvelope
  ) => Effect.Effect<void, never, never>
  readonly dispose: () => Effect.Effect<void, never, never>
}

export interface BridgeStreamRuntimeOptions {
  readonly now?: () => number
  readonly nextStreamId?: () => string
  readonly cleanupGraceMs?: number
  readonly registry?: BridgeStreamRegistry
}

interface ResolvedBridgeStreamRuntimeOptions {
  readonly now: () => number
  readonly nextStreamId: () => string
  readonly cleanupGraceMs: number
  readonly registry: BridgeStreamRegistry
}

export type BridgeStreamLayerEnvironment<Layer> =
  Layer extends BridgeRpcLayer<string, infer Spec, infer Handlers>
    ? {
        readonly [Method in keyof Spec]: HandlerEnvironment<Handlers[Method]>
      }[keyof Spec]
    : never

type HandlerEnvironment<Handler> = Handler extends (
  ...args: infer _Args
) => Stream.Stream<unknown, unknown, infer Env>
  ? Env
  : never

type AnyBridgeRpcLayer = {
  readonly group: BridgeRpcGroup<string, BridgeRpcSpec>
  readonly handlers: object
}

type BoundStream = {
  readonly spec: BridgeRpcMethodSpec & { readonly output: BridgeRpcStreamSpec }
  readonly handler: (input: unknown) => Stream.Stream<unknown, unknown, unknown>
}

type StreamQueue = {
  readonly capacity: number
  readonly evictedFrames: Ref.Ref<number>
  readonly overflow: NonNullable<BackpressureSpec["overflow"]>
  readonly queue: Queue.Queue<HostProtocolStreamEnvelope, HostProtocolError | Cause.Done>
}

type ActiveStream = {
  readonly options: ResolvedBridgeStreamRuntimeOptions
  readonly queue: StreamQueue
  readonly request: HostProtocolRequestEnvelope
  readonly streamId: string
}

type ActiveBridgeStreams = {
  readonly state: SubscriptionRef.SubscriptionRef<ActiveBridgeStreamsState>
  readonly fibers: FiberMap.FiberMap<string, void, never>
  readonly lifecycle: Semaphore.Semaphore
  readonly scope: Scope.Closeable
}

type ActiveBridgeStreamsState = {
  readonly closed: boolean
  readonly entries: ReadonlyMap<string, ActiveStream>
}

type ActiveStreamReservation =
  | { readonly _tag: "Reserved" }
  | { readonly _tag: "Disposed" }
  | { readonly _tag: "DuplicateRequest"; readonly requestId: string }
  | { readonly _tag: "DuplicateResource"; readonly streamId: string }

type BridgeStreamRegistryState = {
  readonly entries: ReadonlyMap<string, BridgeStreamRegistryEntry>
  readonly generations: ReadonlyMap<string, number>
}

export type BridgeStreamTerminalType = "complete" | "error" | "closed"

export interface BridgeStreamRegistryEntry {
  readonly streamId: string
  readonly generation: number
  readonly state: "open" | "terminal"
  readonly terminal?: BridgeStreamTerminalType
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
    terminal: BridgeStreamTerminalType,
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

export const makeBridgeStreamRegistry = (
  cleanupGraceMs = 30_000
): Effect.Effect<BridgeStreamRegistry, never, never> =>
  Effect.gen(function* () {
    const state = yield* SubscriptionRef.make<BridgeStreamRegistryState>({
      entries: new Map(),
      generations: new Map()
    })

    const registry: BridgeStreamRegistry = {
      register: (streamId) =>
        SubscriptionRef.modify(state, (current) => {
          const previousGeneration = current.generations.get(streamId)
          const generation = previousGeneration === undefined ? 0 : previousGeneration + 1
          const entry = { streamId, generation, state: "open" } satisfies BridgeStreamRegistryEntry
          const entries = new Map(current.entries)
          const generations = new Map(current.generations)
          entries.set(streamId, entry)
          generations.set(streamId, generation)
          return [entry, { entries, generations }] as const
        }),
      terminate: (streamId, terminal, now) =>
        SubscriptionRef.modifySome(state, (current) => {
          const entry = current.entries.get(streamId)
          if (entry?.state === "terminal") {
            return [false, Option.none()] as const
          }
          const generation = entry?.generation ?? 0
          const entries = new Map(current.entries)
          const generations = new Map(current.generations)
          entries.set(streamId, {
            generation,
            state: "terminal",
            streamId,
            terminal,
            terminalAt: now
          })
          generations.set(streamId, generation)
          return [true, Option.some({ entries, generations })] as const
        }),
      isTerminal: (streamId) =>
        SubscriptionRef.get(state).pipe(
          Effect.map((current) => current.entries.get(streamId)?.state === "terminal")
        ),
      updateBackpressure: (streamId, metrics) =>
        SubscriptionRef.modifySome(state, (current) => {
          const entry = current.entries.get(streamId)
          if (entry === undefined) {
            return [undefined, Option.none()] as const
          }
          const entries = new Map(current.entries)
          entries.set(streamId, {
            ...entry,
            backpressure: metrics
          })
          return [undefined, Option.some({ ...current, entries })] as const
        }),
      gcExpired: (now) =>
        SubscriptionRef.modifySome(state, (current) => {
          let removed = 0
          const entries = new Map(current.entries)
          for (const [streamId, entry] of current.entries) {
            if (
              entry.state === "terminal" &&
              entry.terminalAt !== undefined &&
              now - entry.terminalAt >= cleanupGraceMs
            ) {
              entries.delete(streamId)
              removed += 1
            }
          }
          if (removed === 0) {
            return [0, Option.none()] as const
          }
          return [removed, Option.some({ ...current, entries })] as const
        }),
      snapshot: () => SubscriptionRef.get(state).pipe(Effect.map(registrySnapshot)),
      observe: () => SubscriptionRef.changes(state).pipe(Stream.map(registrySnapshot))
    }

    return Object.freeze(registry)
  })

const registrySnapshot = (
  state: BridgeStreamRegistryState
): ReadonlyArray<BridgeStreamRegistryEntry> => Array.from(state.entries.values())

const makeActiveBridgeStreams = (): Effect.Effect<ActiveBridgeStreams, never, never> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make("sequential")
    const fibers = yield* Scope.provide(FiberMap.make<string, void, never>(), scope)
    const lifecycle = yield* Semaphore.make(1)
    const state = yield* SubscriptionRef.make<ActiveBridgeStreamsState>({
      closed: false,
      entries: new Map()
    })

    return Object.freeze({ state, fibers, lifecycle, scope })
  })

const openActiveStream = (
  active: ActiveBridgeStreams,
  stream: ActiveStream
): Effect.Effect<ActiveStreamReservation, never, never> =>
  SubscriptionRef.modifyEffect(
    active.state,
    (
      state
    ): Effect.Effect<
      readonly [ActiveStreamReservation, ActiveBridgeStreamsState],
      never,
      never
    > => {
      if (state.closed) {
        return Effect.succeed([{ _tag: "Disposed" }, state] as const)
      }
      if (state.entries.has(stream.request.id)) {
        return Effect.succeed([
          { _tag: "DuplicateRequest", requestId: stream.request.id },
          state
        ] satisfies readonly [ActiveStreamReservation, ActiveBridgeStreamsState])
      }
      if (Array.from(state.entries.values()).some((entry) => entry.streamId === stream.streamId)) {
        return Effect.succeed([
          { _tag: "DuplicateResource", streamId: stream.streamId },
          state
        ] satisfies readonly [ActiveStreamReservation, ActiveBridgeStreamsState])
      }
      return Effect.gen(function* () {
        yield* stream.options.registry.register(stream.streamId)
        yield* syncBackpressureMetrics(stream.options.registry, stream.streamId, stream.queue)
        const entries = new Map(state.entries)
        entries.set(stream.request.id, stream)
        return [{ _tag: "Reserved" }, { ...state, entries }] as const
      })
    }
  )

const unregisterActiveStream = (
  active: ActiveBridgeStreams,
  requestId: string,
  streamId: string
): Effect.Effect<void, never, never> =>
  SubscriptionRef.update(active.state, (state) => {
    const next = new Map(state.entries)
    const current = next.get(requestId)
    if (current?.streamId === streamId) {
      next.delete(requestId)
    }
    return { ...state, entries: next }
  })

const interruptActiveStream = (
  active: ActiveBridgeStreams,
  requestId: string,
  streamId: string
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    yield* FiberMap.remove(active.fibers, streamId)
    yield* unregisterActiveStream(active, requestId, streamId)
  })

const closeActiveStream = (
  active: ActiveBridgeStreams,
  stream: ActiveStream
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const frame = yield* Effect.exit(closedFrame(stream.request, stream.streamId, stream.options))
    if (Exit.isSuccess(frame)) {
      yield* offerTerminalFrame(stream.queue, frame.value, stream.options, "closed")
    } else {
      yield* stream.options.registry.terminate(
        stream.streamId,
        "closed",
        safeTerminalNow(stream.options)
      )
    }
    yield* Queue.end(stream.queue.queue)
    yield* interruptActiveStream(active, stream.request.id, stream.streamId)
  })

const disposeActiveStreams = (active: ActiveBridgeStreams): Effect.Effect<void, never, never> =>
  active.lifecycle.withPermit(
    Effect.gen(function* () {
      const streams = yield* SubscriptionRef.modify(active.state, (state) => [
        Array.from(state.entries.values()),
        { closed: true, entries: new Map() }
      ])
      for (const stream of streams) {
        yield* closeActiveStream(active, stream)
      }
      yield* Scope.close(active.scope, Exit.void)
    })
  )

const findActiveStream = (
  active: ActiveBridgeStreams,
  request: HostProtocolCancelByRequestEnvelope | HostProtocolCancelByResourceEnvelope
): Effect.Effect<ActiveStream | undefined, never, never> =>
  SubscriptionRef.get(active.state).pipe(
    Effect.map((state) => {
      const streamByRequest = request.id === undefined ? undefined : state.entries.get(request.id)
      if (streamByRequest !== undefined) {
        return streamByRequest
      }

      return Array.from(state.entries.values()).find(
        (stream) =>
          stream.streamId === request.resourceId || stream.request.id === request.resourceId
      )
    })
  )

const activeStreamReservationFailure = (
  reservation: Exclude<ActiveStreamReservation, { readonly _tag: "Reserved" }>,
  operation: string
): HostProtocolError => {
  switch (reservation._tag) {
    case "Disposed":
      return makeHostProtocolInvalidStateError("disposed", "stream", operation)
    case "DuplicateRequest":
      return makeHostProtocolInvalidArgumentError(
        "id",
        "request already active",
        reservation.requestId
      )
    case "DuplicateResource":
      return makeHostProtocolInvalidArgumentError(
        "streamId",
        "stream already active",
        reservation.streamId
      )
  }
}

const makeStreams = <Layers extends readonly AnyBridgeRpcLayer[]>(
  ...layers: Layers
): Effect.Effect<
  BridgeStreamRuntime<BridgeStreamLayerEnvironment<Layers[number]>>,
  never,
  Scope.Scope
> => makeStreamsWithOptions({}, ...layers)

const makeStreamsWithOptions = <Layers extends readonly AnyBridgeRpcLayer[]>(
  options: BridgeStreamRuntimeOptions,
  ...layers: Layers
): Effect.Effect<
  BridgeStreamRuntime<BridgeStreamLayerEnvironment<Layers[number]>>,
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const active = yield* Effect.acquireRelease(makeActiveBridgeStreams(), disposeActiveStreams)
    const table = new Map<string, BoundStream>()
    const resolved = yield* resolveOptions(options)

    for (const layer of layers) {
      for (const [method, spec] of Object.entries(layer.group.spec)) {
        if (!isStreamSpec(spec.output)) {
          continue
        }

        const operation = methodName(layer.group.tag, method)
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

    const runtime: BridgeStreamRuntime<BridgeStreamLayerEnvironment<Layers[number]>> = {
      stream: (request: HostProtocolRequestEnvelope) =>
        streamDispatch(table, active, resolved, request) as Stream.Stream<
          HostProtocolStreamEnvelope,
          HostProtocolError,
          BridgeStreamLayerEnvironment<Layers[number]>
        >,
      cancel: (request) => cancelStream(active, request),
      dispose: () => disposeActiveStreams(active)
    }

    return Object.freeze(runtime)
  })

export const Streams = {
  scoped: makeStreams,
  scopedWithOptions: makeStreamsWithOptions
}

const streamDispatch = (
  table: ReadonlyMap<string, BoundStream>,
  active: ActiveBridgeStreams,
  options: ResolvedBridgeStreamRuntimeOptions,
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
      const input = yield* decodeInput(request.method, bound.spec.input, request.payload)
      yield* options.registry.gcExpired(options.now())
      const streamId = options.nextStreamId()
      if (typeof streamId !== "string" || streamId.length === 0) {
        return Stream.fail(
          makeHostProtocolInvalidArgumentError(
            "streamId",
            "stream id must be non-empty",
            request.method
          )
        )
      }
      const queue = yield* makeStreamQueue(bound.spec)
      const stream = { options, queue, request, streamId }
      const reservation = yield* active.lifecycle.withPermit(
        Effect.gen(function* () {
          const reservation = yield* openActiveStream(active, stream)
          if (reservation._tag !== "Reserved") {
            return reservation
          }
          yield* FiberMap.run(
            active.fibers,
            streamId,
            runProducer(request, streamId, bound, queue, options, bound.handler(input)).pipe(
              Effect.ensuring(unregisterActiveStream(active, request.id, streamId))
            )
          )
          return reservation
        })
      )
      if (reservation._tag !== "Reserved") {
        return Stream.fail(activeStreamReservationFailure(reservation, request.method))
      }

      return Stream.fromQueue(queue.queue).pipe(
        Stream.tap(() => syncBackpressureMetrics(options.registry, streamId, queue)),
        Stream.ensuring(closeActiveStream(active, stream))
      )
    })
  )
}

const cancelStream = (
  active: ActiveBridgeStreams,
  request: HostProtocolCancelByRequestEnvelope | HostProtocolCancelByResourceEnvelope
): Effect.Effect<void, never, never> =>
  active.lifecycle.withPermit(
    Effect.gen(function* () {
      const stream = yield* findActiveStream(active, request)

      if (stream === undefined) {
        return
      }

      yield* closeActiveStream(active, stream)
    })
  )

const runProducer = (
  request: HostProtocolRequestEnvelope,
  streamId: string,
  bound: BoundStream,
  streamQueue: StreamQueue,
  options: ResolvedBridgeStreamRuntimeOptions,
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
  options: ResolvedBridgeStreamRuntimeOptions
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
  options: ResolvedBridgeStreamRuntimeOptions,
  terminal: BridgeStreamTerminalType
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
          const taken = Queue.takeUnsafe(streamQueue.queue)
          if (taken === undefined || Exit.isFailure(taken)) {
            return evictions
          }
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
  spec: BridgeRpcStreamSpec,
  chunk: unknown,
  options: ResolvedBridgeStreamRuntimeOptions
): Effect.Effect<HostProtocolStreamEnvelope, HostProtocolError, never> =>
  Effect.gen(function* () {
    const encodedChunk = yield* encodeStreamChunk(request.method, spec.chunk, chunk)

    return yield* streamFrame(
      request,
      streamId,
      options,
      new BridgeStreamDataFrame({ type: "data", chunk: encodedChunk })
    )
  })

const encodeErrorFrame = (
  request: HostProtocolRequestEnvelope,
  streamId: string,
  spec: BridgeRpcStreamSpec,
  cause: Cause.Cause<unknown>,
  options: ResolvedBridgeStreamRuntimeOptions
): Effect.Effect<HostProtocolStreamEnvelope, HostProtocolError, never> =>
  Effect.gen(function* () {
    const fail = cause.reasons.find(Cause.isFailReason)
    const error = fail === undefined ? formatUnknownError(cause) : fail.error
    const protocolError = yield* Effect.option(decodeHostProtocolError(error))
    if (Option.isSome(protocolError)) {
      return yield* protocolErrorFrame(request, streamId, options, protocolError.value)
    }

    const encoded = yield* encodeStreamError(request.method, spec.error, error).pipe(
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
      new BridgeStreamErrorFrame({ type: "error", error: encoded })
    )
  })

const completeFrame = (
  request: HostProtocolRequestEnvelope,
  streamId: string,
  options: ResolvedBridgeStreamRuntimeOptions
): Effect.Effect<HostProtocolStreamEnvelope, HostProtocolError, never> =>
  streamFrame(request, streamId, options, new BridgeStreamCompleteFrame({ type: "complete" }))

const closedFrame = (
  request: HostProtocolRequestEnvelope,
  streamId: string,
  options: ResolvedBridgeStreamRuntimeOptions
): Effect.Effect<HostProtocolStreamEnvelope, HostProtocolError, never> =>
  streamFrame(request, streamId, options, new BridgeStreamClosedFrame({ type: "closed" }))

const streamFrame = (
  request: HostProtocolRequestEnvelope,
  streamId: string,
  options: ResolvedBridgeStreamRuntimeOptions,
  frame: BridgeStreamFrame
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
  options: ResolvedBridgeStreamRuntimeOptions,
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
  Schema.decodeUnknownEffect(HostProtocolErrorSchema)(error, StrictParseOptions)

const decodeInput = <Type, Encoded>(
  operation: string,
  schema: BridgeRpcCodec<Type, Encoded>,
  payload: unknown
): Effect.Effect<Type, HostProtocolError, never> =>
  Schema.decodeUnknownEffect(schema)(payload, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const encodeStreamChunk = <Type, Encoded>(
  operation: string,
  schema: BridgeRpcCodec<Type, Encoded>,
  chunk: unknown
): Effect.Effect<Encoded, HostProtocolError, never> =>
  Schema.encodeUnknownEffect(schema)(chunk, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )

const encodeStreamError = <Type, Encoded>(
  operation: string,
  schema: BridgeRpcCodec<Type, Encoded>,
  error: unknown
): Effect.Effect<Encoded, HostProtocolError, never> =>
  Schema.encodeUnknownEffect(schema)(error, StrictParseOptions).pipe(
    Effect.mapError((schemaError) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(schemaError))
    )
  )

const resolveOptions = (
  options: BridgeStreamRuntimeOptions
): Effect.Effect<ResolvedBridgeStreamRuntimeOptions, never, never> =>
  Effect.gen(function* () {
    const cleanupGraceMs = options.cleanupGraceMs ?? 30_000
    const registry = options.registry ?? (yield* makeBridgeStreamRegistry(cleanupGraceMs))

    return {
      cleanupGraceMs,
      now: options.now ?? Date.now,
      nextStreamId: options.nextStreamId ?? (() => `stream-${globalThis.crypto.randomUUID()}`),
      registry
    }
  })

const safeTerminalNow = (options: ResolvedBridgeStreamRuntimeOptions): number => {
  const now = options.now()
  return Number.isFinite(now) ? now : Date.now()
}

const methodName = (tag: string, method: string): string => `${tag}.${method}`

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
