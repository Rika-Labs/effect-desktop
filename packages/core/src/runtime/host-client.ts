import {
  decodeHostProtocolFrameJson,
  makeHostProtocolBinaryDecodeError,
  makeHostProtocolFrameTooLargeError,
  makeHostProtocolHostUnavailableError,
  makeHostProtocolInvalidOutputError,
  encodeHostProtocolFrame,
  parseHostProtocolFrameJson
} from "@effect-desktop/bridge"
import type {
  HostHandshakeExchange,
  HostProtocolError,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope
} from "@effect-desktop/bridge"
import { Effect, Option, Random, Stream } from "effect"

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

interface ResolvedHostProtocolExchangeOptions {
  readonly audit: AuditEventsApi | undefined
  readonly nextTraceId: (() => string) | undefined
}

export const createHostProtocolExchange = (
  transport: TransportConnection,
  options: HostProtocolExchangeOptions = {}
): HostHandshakeExchange => ({
  request: (request) =>
    Effect.gen(function* () {
      const resolved = resolveOptions(options)
      yield* sendRequest(transport, request)
      const frame = yield* receiveResponseFrame(transport)
      return yield* decodeResponseFrame(request, frame, resolved)
    })
})

const sendRequest = (
  transport: TransportConnection,
  request: HostProtocolRequestEnvelope
): Effect.Effect<void, HostProtocolError, never> =>
  encodeHostProtocolFrame(request, request.method).pipe(
    Effect.flatMap((frame) => transport.send(frame).pipe(Effect.mapError(classifyTransportError)))
  )

const receiveResponseFrame = (
  transport: TransportConnection
): Effect.Effect<Uint8Array, HostProtocolError, never> =>
  transport.receive.pipe(
    Stream.runHead,
    Effect.mapError(classifyTransportError),
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(makeHostProtocolHostUnavailableError("TransportConnection.receive")),
        onSome: Effect.succeed
      })
    )
  )

const decodeResponseFrame = (
  request: HostProtocolRequestEnvelope,
  frame: Uint8Array,
  options: ResolvedHostProtocolExchangeOptions
): Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never> =>
  Effect.gen(function* () {
    const parsed = yield* parseHostProtocolFrameJson(frame, request.method)
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

    if (envelope.id !== request.id) {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(
          request.method,
          `expected response id ${request.id} for ${request.method}; got ${envelope.id}`
        )
      )
    }

    if (!repaired.traceIdWasMissing && envelope.traceId !== request.traceId) {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(
          request.method,
          `expected response traceId ${request.traceId} for ${request.method}; got ${envelope.traceId}`
        )
      )
    }

    return envelope
  })

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
): value is { readonly kind: string; readonly traceId?: unknown } =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  typeof Reflect.get(value, "kind") === "string"

const hostProtocolObjectTimestamp = (
  value: { readonly kind: string },
  operation: string
): Effect.Effect<number, HostProtocolError, never> => {
  const timestamp = Reflect.get(value, "timestamp")
  return Number.isSafeInteger(timestamp) && timestamp >= 0
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
