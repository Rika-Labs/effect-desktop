import { Effect, Schema } from "effect"

import {
  HOST_PING_METHOD,
  HOST_PROTOCOL_VERSION,
  HOST_VERSION_METHOD,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolInvalidStateError,
  type HostProtocolError
} from "./protocol.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
const NulByte = String.fromCharCode(0)
const UnitSeparatorByte = String.fromCharCode(31)
const DeleteByte = String.fromCharCode(127)
const NoControlTextPattern = new RegExp(`^[^${NulByte}-${UnitSeparatorByte}${DeleteByte}]+$`, "u")
const ProtocolVersion = Schema.NonEmptyString.check(Schema.isPattern(NoControlTextPattern))

export class HostVersionPayload extends Schema.Class<HostVersionPayload>("HostVersionPayload")({
  protocolVersion: ProtocolVersion
}) {}

export interface HostHandshakeExchange {
  readonly request: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never>
}

export interface HostHandshakeClient {
  readonly ping: () => Effect.Effect<void, HostProtocolError, never>
  readonly version: () => Effect.Effect<HostVersionPayload, HostProtocolError, never>
}

export interface HostHandshakeClientOptions {
  readonly nextRequestId?: () => string
  readonly nextTraceId?: () => string
  readonly now?: () => number
}

interface ResolvedHostHandshakeClientOptions {
  readonly nextRequestId: () => string
  readonly nextTraceId: () => string
  readonly now: () => number
}

export const makeHostHandshakeClient = (
  exchange: HostHandshakeExchange,
  options: HostHandshakeClientOptions = {}
): HostHandshakeClient => {
  const resolved = resolveOptions(options)

  return {
    ping: () =>
      Effect.gen(function* () {
        const request = makeRequest(HOST_PING_METHOD, resolved)
        yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
      }),
    version: () =>
      Effect.gen(function* () {
        const request = makeRequest(HOST_VERSION_METHOD, resolved)
        const response = yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )

        return yield* decodeVersionPayload(response.payload)
      })
  }
}

export const negotiateHostVersion = (
  client: HostHandshakeClient,
  expectedProtocolVersion = HOST_PROTOCOL_VERSION
): Effect.Effect<HostVersionPayload, HostProtocolError, never> =>
  Effect.gen(function* () {
    const version = yield* client.version()
    if (version.protocolVersion !== expectedProtocolVersion) {
      return yield* Effect.fail(
        makeHostProtocolInvalidStateError(
          version.protocolVersion,
          expectedProtocolVersion,
          HOST_VERSION_METHOD
        )
      )
    }

    return version
  })

const requireMatchingResponse = (
  request: HostProtocolRequestEnvelope,
  response: HostProtocolResponseEnvelope
): Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never> => {
  if (response.id !== request.id) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(
        request.method,
        `response id ${response.id} does not match request id ${request.id}`
      )
    )
  }
  return Effect.succeed(response)
}

const requireSuccess = (
  response: HostProtocolResponseEnvelope
): Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never> => {
  if (response.error !== undefined) {
    return Effect.fail(response.error)
  }

  return Effect.succeed(response)
}

const decodeUnknownHostVersionPayload = Schema.decodeUnknownSync(HostVersionPayload)

const decodeVersionPayload = (
  payload: unknown
): Effect.Effect<HostVersionPayload, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownHostVersionPayload(payload, StrictParseOptions),
    catch: (error) =>
      makeHostProtocolInvalidOutputError(HOST_VERSION_METHOD, formatUnknownError(error))
  })

const makeRequest = (
  method: string,
  options: ResolvedHostHandshakeClientOptions
): HostProtocolRequestEnvelope =>
  new HostProtocolRequestEnvelope({
    kind: "request",
    id: options.nextRequestId(),
    method,
    timestamp: options.now(),
    traceId: options.nextTraceId()
  })

const resolveOptions = (
  options: HostHandshakeClientOptions
): ResolvedHostHandshakeClientOptions => ({
  nextRequestId: options.nextRequestId ?? (() => `request-${globalThis.crypto.randomUUID()}`),
  nextTraceId: options.nextTraceId ?? (() => `trace-${globalThis.crypto.randomUUID()}`),
  now: options.now ?? Date.now
})

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
