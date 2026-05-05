import { Effect, Schema } from "effect"

import {
  HOST_PING_METHOD,
  HOST_PROTOCOL_VERSION,
  HOST_VERSION_METHOD,
  HostProtocolInvalidOutputError,
  HostProtocolInvalidStateError,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  type HostProtocolError
} from "./protocol.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

export class HostVersionPayload extends Schema.Class<HostVersionPayload>("HostVersionPayload")({
  protocolVersion: Schema.String
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
        yield* requireSuccess(yield* exchange.request(makeRequest(HOST_PING_METHOD, resolved)))
      }),
    version: () =>
      Effect.gen(function* () {
        const response = yield* requireSuccess(
          yield* exchange.request(makeRequest(HOST_VERSION_METHOD, resolved))
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
        new HostProtocolInvalidStateError({
          tag: "InvalidState",
          current: version.protocolVersion,
          attempted: expectedProtocolVersion
        })
      )
    }

    return version
  })

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
      new HostProtocolInvalidOutputError({
        tag: "InvalidOutput",
        method: HOST_VERSION_METHOD,
        reason: formatUnknownError(error)
      })
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
