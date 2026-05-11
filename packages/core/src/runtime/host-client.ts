import {
  decodeHostProtocolEnvelope,
  encodeHostProtocolEnvelope,
  makeHostProtocolBinaryDecodeError,
  makeHostProtocolFrameTooLargeError,
  makeHostProtocolHostUnavailableError,
  makeHostProtocolInvalidOutputError
} from "@effect-desktop/bridge"
import type {
  HostHandshakeExchange,
  HostProtocolError,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope
} from "@effect-desktop/bridge"
import { Effect } from "effect"

import { AuditEvent, emitAuditEvent, type AuditEventsApi } from "./audit-events.js"
import { FrameTooLargeError, FrameTruncatedError, type FramedTransport } from "./transport.js"

const TextEncoderCtor = globalThis.TextEncoder
const TextDecoderCtor = globalThis.TextDecoder
const TextDecoderUtf8 = new TextDecoderCtor("utf-8", { fatal: true })

export interface HostProtocolExchangeOptions {
  readonly audit?: AuditEventsApi
  readonly nextTraceId?: () => string
}

interface ResolvedHostProtocolExchangeOptions {
  readonly audit: AuditEventsApi | undefined
  readonly nextTraceId: () => string
}

export const createHostProtocolExchange = (
  transport: FramedTransport,
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
  transport: FramedTransport,
  request: HostProtocolRequestEnvelope
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.tryPromise({
    try: async () => {
      const encoded = encodeHostProtocolEnvelope(request)
      await transport.send(new TextEncoderCtor().encode(JSON.stringify(encoded)))
    },
    catch: (error) => classifyTransportError(error, "FramedTransport.send")
  })

const receiveResponseFrame = (
  transport: FramedTransport
): Effect.Effect<Uint8Array, HostProtocolError, never> =>
  Effect.tryPromise({
    try: () => transport.recv(),
    catch: (error) => classifyTransportError(error, "FramedTransport.recv")
  }).pipe(
    Effect.flatMap((frame) =>
      frame === null
        ? Effect.fail(makeHostProtocolHostUnavailableError("FramedTransport.recv"))
        : Effect.succeed(frame)
    )
  )

const decodeResponseFrame = (
  request: HostProtocolRequestEnvelope,
  frame: Uint8Array,
  options: ResolvedHostProtocolExchangeOptions
): Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => {
        return JSON.parse(TextDecoderUtf8.decode(frame)) as unknown
      },
      catch: (error) => makeHostProtocolBinaryDecodeError(formatUnknownError(error), request.method)
    })
    const repaired = yield* ensureTraceId(parsed, request, options)

    const envelope = yield* Effect.try({
      try: () => decodeHostProtocolEnvelope(repaired.value),
      catch: (error) =>
        makeHostProtocolInvalidOutputError(request.method, formatUnknownError(error))
    })

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

    const traceId = options.nextTraceId()
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
  nextTraceId: options.nextTraceId ?? (() => `trace-${globalThis.crypto.randomUUID()}`)
})

const classifyTransportError = (error: unknown, operation: string): HostProtocolError => {
  if (error instanceof FrameTooLargeError) {
    return makeHostProtocolFrameTooLargeError(error.size, error.max, operation)
  }

  if (error instanceof FrameTruncatedError) {
    return makeHostProtocolBinaryDecodeError(error.message, operation)
  }

  return makeHostProtocolHostUnavailableError(operation)
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
