import { expect, test } from "bun:test"
import { Cause, Clock, Effect, Exit, Schema } from "effect"

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

test("host handshake client requests host.version and decodes the protocol version", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostHandshakeClient(versionExchange(requests, HOST_PROTOCOL_VERSION), {
        nextRequestId: () => "request-version",
        nextTraceId: () => "trace-version",
        now: () => 1710000000000
      })

      const version = yield* client.version()

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
  ))

test("host handshake client requests host.ping", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const timestamp = 1_715_000_000_001
      const requests: HostProtocolRequestEnvelope[] = []
      const client = makeHostHandshakeClient(pingExchange(requests), {
        nextRequestId: () => "request-ping",
        nextTraceId: () => "trace-ping"
      })

      yield* client.ping().pipe(Effect.provideService(Clock.Clock, fixedClock(timestamp)))

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
  ))

test("host version negotiation fails on protocol mismatch", () =>
  Effect.runPromise(
    expectEffectFailure(
      negotiateHostVersion(
        makeHostHandshakeClient(versionExchange([], "9.9.9"), {
          nextRequestId: () => "request-version",
          nextTraceId: () => "trace-version",
          now: () => 1710000000002
        })
      ),
      (error) =>
        Schema.is(HostProtocolInvalidStateError)(error) &&
        error.current === "9.9.9" &&
        error.attempted === HOST_PROTOCOL_VERSION
    )
  ))

test("host version response rejects control bytes", () =>
  Effect.runPromise(
    expectEffectFailure(
      makeHostHandshakeClient(versionExchange([], "1.0.0\x00evil"), {
        nextRequestId: () => "request-version",
        nextTraceId: () => "trace-version",
        now: () => 1710000000004
      }).version(),
      (error) => Schema.is(HostProtocolInvalidOutputError)(error)
    )
  ))

test("host handshake client rejects mismatched response ids", () =>
  Effect.runPromise(
    expectEffectFailure(
      makeHostHandshakeClient(mismatchedVersionExchange(), {
        nextRequestId: () => "request-version",
        nextTraceId: () => "trace-version",
        now: () => 1710000000005
      }).version(),
      (error) => Schema.is(HostProtocolInvalidOutputError)(error)
    )
  ))

test("host handshake client propagates response errors", () =>
  Effect.runPromise(
    expectEffectFailure(
      makeHostHandshakeClient(errorExchange(), {
        nextRequestId: () => "request-version",
        nextTraceId: () => "trace-version",
        now: () => 1710000000003
      }).version(),
      (error) => Schema.is(HostProtocolUnsupportedError)(error)
    )
  ))

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

class ExpectedFailureMissing extends Schema.TaggedErrorClass<ExpectedFailureMissing>()(
  "ExpectedFailureMissing",
  {}
) {}

const expectEffectFailure = <A, E>(
  effect: Effect.Effect<A, E, never>,
  predicate: (error: unknown) => boolean
): Effect.Effect<void, ExpectedFailureMissing, never> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect)
    if (Exit.isFailure(exit)) {
      const failure = exit.cause.reasons.find(Cause.isFailReason)
      expect(predicate(failure?.error)).toBe(true)
      return
    }
    return yield* new ExpectedFailureMissing()
  })

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.yieldNow
})
