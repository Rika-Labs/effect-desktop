import {
  decodeHostProtocolFrameJson,
  makeHostProtocolBinaryDecodeError,
  makeHostProtocolFrameTooLargeError,
  makeHostProtocolHostUnavailableError,
  makeHostProtocolInvalidOutputError,
  encodeHostProtocolFrame,
  parseHostProtocolFrameJson
} from "@orika/bridge"
import type {
  HostHandshakeExchange,
  HostProtocolError,
  HostProtocolEventEnvelope,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope
} from "@orika/bridge"
import { Deferred, Effect, Exit, Fiber, FiberSet, Queue, Random, Scope, Stream } from "effect"

import { AuditEvent, emitAuditEvent, type AuditEventsApi } from "./audit-events.js"
import {
  TransportFrameTooLargeError,
  TransportFrameTruncatedError,
  type TransportConnection,
  type TransportError
} from "./transport.js"

export interface HostProtocolExchangeOptions {
  readonly audit?: AuditEventsApi
  readonly nextTraceId?: () => string
}

const EventReplayLimit = 64

interface ResolvedHostProtocolExchangeOptions {
  readonly audit: AuditEventsApi | undefined
  readonly nextTraceId: (() => string) | undefined
}

export const createHostProtocolExchange = (
  transport: TransportConnection,
  options: HostProtocolExchangeOptions = {}
): HostHandshakeExchange => {
  const eventBus = makeHostEventBus()
  const reader = makeHostProtocolReader(eventBus)
  const resolved = resolveOptions(options)

  return {
    request: (request) =>
      Effect.gen(function* () {
        if (reader.fatal !== undefined) {
          return yield* Effect.fail(reader.fatal)
        }
        if (reader.pending.has(request.id)) {
          return yield* Effect.fail(
            makeHostProtocolInvalidOutputError(
              request.method,
              `duplicate pending host protocol request id ${request.id}`
            )
          )
        }
        const deferred = yield* Deferred.make<HostProtocolResponseEnvelope, HostProtocolError>()
        reader.pending.set(request.id, { request, deferred })
        yield* startHostProtocolReader(transport, resolved, reader)
        yield* sendRequest(transport, request).pipe(
          Effect.catch((error) => {
            reader.pending.delete(request.id)
            return Effect.fail(error)
          })
        )
        return yield* Deferred.await(deferred).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              reader.pending.delete(request.id)
            })
          )
        )
      }),
    subscribe: (method) =>
      Stream.unwrap(
        startHostProtocolReader(transport, resolved, reader).pipe(
          Effect.as(subscribeHostEvent(eventBus, method))
        )
      ),
    close: () => closeHostProtocolReader(reader, transport)
  }
}

const sendRequest = (
  transport: TransportConnection,
  request: HostProtocolRequestEnvelope
): Effect.Effect<void, HostProtocolError, never> =>
  encodeHostProtocolFrame(request, request.method).pipe(
    Effect.flatMap((frame) => transport.send(frame).pipe(Effect.mapError(classifyTransportError)))
  )

interface PendingHostResponse {
  readonly request: HostProtocolRequestEnvelope
  readonly deferred: Deferred.Deferred<HostProtocolResponseEnvelope, HostProtocolError>
}

interface HostProtocolReader {
  readonly eventBus: HostEventBus
  readonly pending: Map<string, PendingHostResponse>
  readonly runFork: <A, E>(effect: Effect.Effect<A, E, never>) => Fiber.Fiber<A, E>
  readonly closeScope: Effect.Effect<void, never, never>
  started: boolean
  fatal: HostProtocolError | undefined
}

const makeHostProtocolReader = (eventBus: HostEventBus): HostProtocolReader => {
  const scope = Effect.runSync(Scope.make())
  const runFork = Effect.runSync(
    Scope.provide(FiberSet.makeRuntime<never, unknown, unknown>(), scope)
  )

  return {
    eventBus,
    pending: new Map(),
    runFork: (effect) => runFork(effect),
    closeScope: Scope.close(scope, Exit.void).pipe(Effect.asVoid),
    started: false,
    fatal: undefined
  }
}

const startHostProtocolReader = (
  transport: TransportConnection,
  options: ResolvedHostProtocolExchangeOptions,
  reader: HostProtocolReader
): Effect.Effect<void, never, never> =>
  Effect.sync(() => {
    if (reader.started) {
      return
    }
    reader.started = true
    reader.runFork(
      runHostProtocolReader(transport, options, reader).pipe(
        Effect.ensuring(transport.close().pipe(Effect.ignore))
      )
    )
  })

const closeHostProtocolReader = (
  reader: HostProtocolReader,
  transport: TransportConnection
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    if (reader.fatal === undefined) {
      yield* failHostProtocolReader(
        reader,
        makeHostProtocolHostUnavailableError("TransportConnection.close")
      )
    }
    const started = reader.started
    yield* reader.closeScope
    if (!started) {
      yield* transport.close().pipe(Effect.ignore)
    }
  })

const runHostProtocolReader = (
  transport: TransportConnection,
  options: ResolvedHostProtocolExchangeOptions,
  reader: HostProtocolReader
): Effect.Effect<void, never, never> =>
  transport.receive.pipe(
    Stream.mapError(classifyTransportError),
    Stream.runForEach((frame) => receiveEnvelopeFrame(reader, frame, options)),
    Effect.andThen(() =>
      failHostProtocolReader(
        reader,
        makeHostProtocolHostUnavailableError("TransportConnection.receive")
      )
    ),
    Effect.catch((error) => failHostProtocolReader(reader, error))
  )

const receiveEnvelopeFrame = (
  reader: HostProtocolReader,
  frame: Uint8Array,
  options: ResolvedHostProtocolExchangeOptions
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.gen(function* () {
    const operation = readerOperation(reader)
    const parsed = yield* parseHostProtocolFrameJson(frame, operation)
    const kind = hostProtocolFrameKind(parsed)
    if (kind === "event") {
      const envelope = yield* decodeHostEventEnvelope(parsed)
      yield* publishHostEvent(reader.eventBus, envelope)
      return
    }
    if (kind !== "response") {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(
          operation,
          `expected response or event envelope; got ${kind ?? "unknown"}`
        )
      )
    }

    const id = hostProtocolResponseId(parsed)
    if (id === undefined) {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(operation, "response envelope missing id")
      )
    }
    const pending = reader.pending.get(id)
    if (pending === undefined) {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(
          operation,
          `received response for unknown request id ${id}`
        )
      )
    }

    const { envelope, traceIdWasMissing } = yield* decodeResponseEnvelopeFrame(
      pending.request,
      parsed,
      options
    )
    const response = yield* validateResponseEnvelope(pending.request, envelope, traceIdWasMissing)
    reader.pending.delete(id)
    yield* Deferred.succeed(pending.deferred, response)
  })

const failHostProtocolReader = (
  reader: HostProtocolReader,
  error: HostProtocolError
): Effect.Effect<void, never, never> => {
  reader.fatal = error
  const pending = [...reader.pending.values()]
  reader.pending.clear()
  return Effect.all(
    [
      Effect.forEach(pending, ({ deferred }) => Deferred.fail(deferred, error), {
        discard: true
      }),
      failHostEventBus(reader.eventBus, error)
    ],
    { discard: true }
  )
}

const decodeHostEventEnvelope = (
  parsed: unknown
): Effect.Effect<HostProtocolEventEnvelope, HostProtocolError, never> =>
  Effect.gen(function* () {
    const operation = hostProtocolEventMethod(parsed) ?? "HostProtocol.receive"
    const envelope = yield* decodeHostProtocolFrameJson(parsed, operation)
    if (envelope.kind !== "event") {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(
          operation,
          `expected event envelope; got ${envelope.kind}`
        )
      )
    }
    return envelope
  })

const decodeResponseEnvelopeFrame = (
  request: HostProtocolRequestEnvelope,
  parsed: unknown,
  options: ResolvedHostProtocolExchangeOptions
): Effect.Effect<
  { readonly envelope: HostProtocolResponseEnvelope; readonly traceIdWasMissing: boolean },
  HostProtocolError,
  never
> =>
  Effect.gen(function* () {
    const repaired = yield* ensureTraceId(parsed, request, options)
    const envelope = yield* decodeHostProtocolFrameJson(repaired.value, request.method)
    if (envelope.kind !== "response") {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(
          request.method,
          `expected response envelope for ${request.method}; got ${envelope.kind}`
        )
      )
    }

    return { envelope, traceIdWasMissing: repaired.traceIdWasMissing }
  })

const hostProtocolFrameKind = (value: unknown): string | undefined => {
  if (!isHostProtocolObject(value) || typeof value.kind !== "string") {
    return undefined
  }
  return value.kind
}

const hostProtocolResponseId = (value: unknown): string | undefined => {
  if (!isHostProtocolObject(value) || !("id" in value) || typeof value.id !== "string") {
    return undefined
  }
  return value.id
}

const hostProtocolEventMethod = (value: unknown): string | undefined => {
  if (!isHostProtocolObject(value) || !("method" in value) || typeof value.method !== "string") {
    return undefined
  }
  return value.method
}

const readerOperation = (reader: HostProtocolReader): string => {
  if (reader.pending.size !== 1) {
    return "HostProtocol.receive"
  }
  const pending = reader.pending.values().next().value
  return pending?.request.method ?? "HostProtocol.receive"
}

const validateResponseEnvelope = (
  request: HostProtocolRequestEnvelope,
  envelope: HostProtocolResponseEnvelope,
  traceIdWasMissing: boolean
): Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never> =>
  Effect.gen(function* () {
    if (envelope.id !== request.id) {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(
          request.method,
          `expected response id ${request.id} for ${request.method}; got ${envelope.id}`
        )
      )
    }

    if (!traceIdWasMissing && envelope.traceId !== request.traceId) {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(
          request.method,
          `expected response traceId ${request.traceId} for ${request.method}; got ${envelope.traceId}`
        )
      )
    }

    return envelope
  })

interface HostEventBus {
  readonly replay: Map<string, HostProtocolEventEnvelope[]>
  readonly subscribers: Map<string, Set<Queue.Queue<HostEventBusItem>>>
  fatal: HostProtocolError | undefined
}

type HostEventBusItem =
  | { readonly _tag: "event"; readonly envelope: HostProtocolEventEnvelope }
  | { readonly _tag: "failure"; readonly error: HostProtocolError }

const makeHostEventBus = (): HostEventBus => ({
  replay: new Map(),
  subscribers: new Map(),
  fatal: undefined
})

const publishHostEvent = (
  bus: HostEventBus,
  envelope: HostProtocolEventEnvelope
): Effect.Effect<void, never, never> => {
  const replay = bus.replay.get(envelope.method) ?? []
  bus.replay.set(envelope.method, [...replay, envelope].slice(-EventReplayLimit))
  const subscribers = bus.subscribers.get(envelope.method)
  if (subscribers === undefined || subscribers.size === 0) {
    return Effect.void
  }

  return Effect.forEach(subscribers, (queue) => Queue.offer(queue, { _tag: "event", envelope }), {
    discard: true
  })
}

const failHostEventBus = (
  bus: HostEventBus,
  error: HostProtocolError
): Effect.Effect<void, never, never> => {
  bus.fatal = error
  return Effect.forEach(
    [...bus.subscribers.values()].flatMap((subscribers) => [...subscribers]),
    (queue) => Queue.offer(queue, { _tag: "failure", error }),
    { discard: true }
  )
}

const subscribeHostEvent = (
  bus: HostEventBus,
  method: string
): Stream.Stream<HostProtocolEventEnvelope, HostProtocolError, never> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<HostEventBusItem>()
      let subscribers = bus.subscribers.get(method)
      if (subscribers === undefined) {
        subscribers = new Set()
        bus.subscribers.set(method, subscribers)
      }
      subscribers.add(queue)

      const fatal = bus.fatal
      if (fatal !== undefined) {
        yield* Queue.offer(queue, { _tag: "failure", error: fatal })
      } else {
        for (const envelope of bus.replay.get(method) ?? []) {
          yield* Queue.offer(queue, { _tag: "event", envelope })
        }
      }

      return Stream.fromQueue(queue).pipe(
        Stream.mapEffect((item) =>
          item._tag === "event" ? Effect.succeed(item.envelope) : Effect.fail(item.error)
        ),
        Stream.ensuring(
          Effect.sync(() => {
            subscribers.delete(queue)
            if (subscribers.size === 0) {
              bus.subscribers.delete(method)
            }
          })
        )
      )
    })
  )

const ensureTraceId = (
  parsed: unknown,
  request: HostProtocolRequestEnvelope,
  options: ResolvedHostProtocolExchangeOptions
): Effect.Effect<
  { readonly value: unknown; readonly traceIdWasMissing: boolean },
  HostProtocolError,
  never
> =>
  Effect.gen(function* () {
    if (!isHostProtocolObject(parsed) || typeof parsed.traceId === "string") {
      return { value: parsed, traceIdWasMissing: false }
    }

    const traceId = yield* nextTraceId(options)
    if (traceId.length === 0) {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(
          request.method,
          "invalid generated host protocol traceId"
        )
      )
    }
    const timestamp = yield* hostProtocolObjectTimestamp(parsed, request.method)
    yield* emitTraceIdMissing(options.audit, traceId, timestamp, request, parsed.kind)

    return {
      value: {
        ...parsed,
        traceId
      },
      traceIdWasMissing: true
    }
  })

const emitTraceIdMissing = (
  audit: AuditEventsApi | undefined,
  traceId: string,
  timestamp: number,
  request: HostProtocolRequestEnvelope,
  boundaryKind: string
): Effect.Effect<void, HostProtocolError, never> =>
  emitAuditEvent(
    audit,
    new AuditEvent({
      kind: "trace-id-missing",
      source: "HostProtocol",
      traceId,
      outcome: "auto-minted",
      timestamp,
      details: {
        boundary: "host-runtime",
        envelopeKind: boundaryKind,
        requestId: request.id,
        method: request.method
      }
    })
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(
        request.method,
        `failed to audit missing host protocol traceId: ${formatUnknownError(error)}`
      )
    )
  )

const isHostProtocolObject = (
  value: unknown
): value is { readonly kind: string; readonly timestamp?: unknown; readonly traceId?: unknown } =>
  typeof value === "object" && value !== null && "kind" in value && typeof value.kind === "string"

const hostProtocolObjectTimestamp = (
  value: { readonly kind: string; readonly timestamp?: unknown },
  operation: string
): Effect.Effect<number, HostProtocolError, never> => {
  const timestamp = value.timestamp
  return typeof timestamp === "number" && Number.isSafeInteger(timestamp) && timestamp >= 0
    ? Effect.succeed(timestamp)
    : Effect.fail(makeHostProtocolInvalidOutputError(operation, "invalid host envelope timestamp"))
}

const resolveOptions = (
  options: HostProtocolExchangeOptions
): ResolvedHostProtocolExchangeOptions => ({
  audit: options.audit,
  nextTraceId: options.nextTraceId
})

const nextTraceId = (
  options: ResolvedHostProtocolExchangeOptions
): Effect.Effect<string, never, never> =>
  options.nextTraceId === undefined
    ? Random.nextUUIDv4.pipe(Effect.map((uuid) => `trace-${uuid}`))
    : Effect.sync(options.nextTraceId)

const classifyTransportError = (error: TransportError): HostProtocolError => {
  if (error instanceof TransportFrameTooLargeError) {
    return makeHostProtocolFrameTooLargeError(error.size, error.max, error.operation)
  }

  if (error instanceof TransportFrameTruncatedError) {
    return makeHostProtocolBinaryDecodeError(error.message, error.operation)
  }

  return makeHostProtocolHostUnavailableError(error.operation)
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
