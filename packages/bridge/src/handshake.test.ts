import { expect, test } from "bun:test"
import { Clock, Effect, Schema } from "effect"

import {
  HOST_PING_METHOD,
  HOST_PROTOCOL_VERSION,
  HOST_VERSION_METHOD,
  HostProtocolInvalidOutputError,
  HostProtocolInvalidStateError,
  HostProtocolResponseEnvelope,
  HostProtocolUnsupportedError,
  makeHostHandshakeClient,
  negotiateHostVersion,
  type HostHandshakeExchange,
  type HostProtocolRequestEnvelope
} from "./index.js"

test("host handshake client requests host.version and decodes the protocol version", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostHandshakeClient(versionExchange(requests, HOST_PROTOCOL_VERSION), {
    nextRequestId: () => "request-version",
    nextTraceId: () => "trace-version",
    now: () => 1710000000000
  })

  const version = await Effect.runPromise(client.version())

  expect(version.protocolVersion).toBe(HOST_PROTOCOL_VERSION)
  expect(requests).toEqual([
    {
      kind: "request",
      id: "request-version",
      method: HOST_VERSION_METHOD,
      timestamp: 1710000000000,
      traceId: "trace-version"
    }
  ])
})

test("host handshake client requests host.ping", async () => {
  const timestamp = 1_715_000_000_001
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostHandshakeClient(pingExchange(requests), {
    nextRequestId: () => "request-ping",
    nextTraceId: () => "trace-ping"
  })

  await Effect.runPromise(
    client.ping().pipe(Effect.provideService(Clock.Clock, fixedClock(timestamp)))
  )

  expect(requests).toEqual([
    {
      kind: "request",
      id: "request-ping",
      method: HOST_PING_METHOD,
      timestamp,
      traceId: "trace-ping"
    }
  ])
})

test("host version negotiation fails on protocol mismatch", async () => {
  const client = makeHostHandshakeClient(versionExchange([], "9.9.9"), {
    nextRequestId: () => "request-version",
    nextTraceId: () => "trace-version",
    now: () => 1710000000002
  })

  await expectEffectFailure(
    negotiateHostVersion(client),
    (error) =>
      Schema.is(HostProtocolInvalidStateError)(error) &&
      error.current === "9.9.9" &&
      error.attempted === HOST_PROTOCOL_VERSION
  )
})

test("host version response rejects control bytes", async () => {
  const client = makeHostHandshakeClient(versionExchange([], "1.0.0\x00evil"), {
    nextRequestId: () => "request-version",
    nextTraceId: () => "trace-version",
    now: () => 1710000000004
  })

  await expectEffectFailure(
    client.version(),
    (error) => Schema.is(HostProtocolInvalidOutputError)(error)
  )
})

test("host handshake client rejects mismatched response ids", async () => {
  const client = makeHostHandshakeClient(mismatchedVersionExchange(), {
    nextRequestId: () => "request-version",
    nextTraceId: () => "trace-version",
    now: () => 1710000000005
  })

  await expectEffectFailure(
    client.version(),
    (error) => Schema.is(HostProtocolInvalidOutputError)(error)
  )
})

test("host handshake client propagates response errors", async () => {
  const client = makeHostHandshakeClient(errorExchange(), {
    nextRequestId: () => "request-version",
    nextTraceId: () => "trace-version",
    now: () => 1710000000003
  })

  await expectEffectFailure(
    client.version(),
    (error) => Schema.is(HostProtocolUnsupportedError)(error)
  )
})

const versionExchange = (
  requests: HostProtocolRequestEnvelope[],
  protocolVersion: string
): HostHandshakeExchange => ({
  request: (request) => {
    requests.push(request)

    return Effect.succeed(
      new HostProtocolResponseEnvelope({
        kind: "response",
        id: request.id,
        timestamp: request.timestamp + 1,
        traceId: request.traceId,
        payload: {
          protocolVersion
        }
      })
    )
  }
})

const pingExchange = (requests: HostProtocolRequestEnvelope[]): HostHandshakeExchange => ({
  request: (request) => {
    requests.push(request)

    return Effect.succeed(
      new HostProtocolResponseEnvelope({
        kind: "response",
        id: request.id,
        timestamp: request.timestamp + 1,
        traceId: request.traceId
      })
    )
  }
})

const mismatchedVersionExchange = (): HostHandshakeExchange => ({
  request: (request) =>
    Effect.succeed(
      new HostProtocolResponseEnvelope({
        kind: "response",
        id: "other-request",
        timestamp: request.timestamp + 1,
        traceId: request.traceId,
        payload: {
          protocolVersion: HOST_PROTOCOL_VERSION
        }
      })
    )
})

const errorExchange = (): HostHandshakeExchange => ({
  request: (request) =>
    Effect.succeed(
      new HostProtocolResponseEnvelope({
        kind: "response",
        id: request.id,
        timestamp: request.timestamp + 1,
        traceId: request.traceId,
        error: new HostProtocolUnsupportedError({
          tag: "Unsupported",
          reason: "not available",
          message: "Unsupported sample",
          operation: HOST_VERSION_METHOD,
          recoverable: false
        })
      })
    )
})

const expectEffectFailure = async (
  effect: Effect.Effect<unknown, unknown, never>,
  predicate: (error: unknown) => boolean
): Promise<void> => {
  try {
    await Effect.runPromise(effect)
  } catch (error) {
    expect(predicate(error)).toBe(true)
    return
  }

  throw new Error("expected Effect to fail")
}

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.yieldNow
})
