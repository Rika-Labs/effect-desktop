import { expect, test } from "bun:test"
import { Effect } from "effect"

import {
  HOST_PING_METHOD,
  HOST_PROTOCOL_VERSION,
  HOST_VERSION_METHOD,
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
  const requests: HostProtocolRequestEnvelope[] = []
  const client = makeHostHandshakeClient(pingExchange(requests), {
    nextRequestId: () => "request-ping",
    nextTraceId: () => "trace-ping",
    now: () => 1710000000001
  })

  await Effect.runPromise(client.ping())

  expect(requests).toEqual([
    {
      kind: "request",
      id: "request-ping",
      method: HOST_PING_METHOD,
      timestamp: 1710000000001,
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
      error instanceof HostProtocolInvalidStateError &&
      error.current === "9.9.9" &&
      error.attempted === HOST_PROTOCOL_VERSION
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
    (error) => error instanceof HostProtocolUnsupportedError
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
          reason: "not available"
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
