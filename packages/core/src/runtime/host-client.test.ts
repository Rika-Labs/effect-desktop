import { expect, test } from "bun:test"
import {
  HostProtocolBinaryDecodeError,
  HostProtocolFrameTooLargeError,
  HostProtocolHostUnavailableError,
  HostProtocolInvalidOutputError,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  encodeHostProtocolEnvelope
} from "@effect-desktop/bridge"
import { Effect, Exit, Stream } from "effect"

import { createHostProtocolExchange } from "./host-client.js"
import type { EventLogAppend, EventLogAppendOptions, EventLogStore } from "./event-log.js"
import { FrameTooLargeError, FrameTruncatedError, type FramedTransport } from "./transport.js"

test("host protocol exchange maps oversized received frames to FrameTooLarge", async () => {
  const exchange = createHostProtocolExchange(
    transport({
      recv: async () => {
        throw new FrameTooLargeError(5, 4)
      }
    })
  )

  const exit = await Effect.runPromiseExit(exchange.request(request()))

  expectFailure(exit, HostProtocolFrameTooLargeError)
  expect(getFailure(exit)).toMatchObject({
    limitBytes: 4,
    operation: "FramedTransport.recv",
    sizeBytes: 5,
    tag: "FrameTooLarge"
  })
})

test("host protocol exchange maps truncated received frames to BinaryDecodeError", async () => {
  const exchange = createHostProtocolExchange(
    transport({
      recv: async () => {
        throw new FrameTruncatedError("body", 8, 2)
      }
    })
  )

  const exit = await Effect.runPromiseExit(exchange.request(request()))

  expectFailure(exit, HostProtocolBinaryDecodeError)
  expect(getFailure(exit)).toMatchObject({
    operation: "FramedTransport.recv",
    tag: "BinaryDecodeError"
  })
})

test("host protocol exchange maps closed host transport to HostUnavailable", async () => {
  const exchange = createHostProtocolExchange(
    transport({
      recv: async () => null
    })
  )

  const exit = await Effect.runPromiseExit(exchange.request(request()))

  expectFailure(exit, HostProtocolHostUnavailableError)
  expect(getFailure(exit)).toMatchObject({
    operation: "FramedTransport.recv",
    tag: "HostUnavailable"
  })
})

test("host protocol exchange maps malformed JSON frames to BinaryDecodeError", async () => {
  const exchange = createHostProtocolExchange(
    transport({
      recv: async () => new TextEncoder().encode("{")
    })
  )

  const exit = await Effect.runPromiseExit(exchange.request(request()))

  expectFailure(exit, HostProtocolBinaryDecodeError)
  expect(getFailure(exit)).toMatchObject({
    operation: "host.ping",
    tag: "BinaryDecodeError"
  })
})

test("host protocol exchange preserves decoded envelope shape failures as InvalidOutput", async () => {
  const exchange = createHostProtocolExchange(
    transport({
      recv: async () => new TextEncoder().encode(JSON.stringify({ kind: "response" }))
    })
  )

  const exit = await Effect.runPromiseExit(exchange.request(request()))

  expectFailure(exit, HostProtocolInvalidOutputError)
  expect(getFailure(exit)).toMatchObject({
    method: "host.ping",
    tag: "InvalidOutput"
  })
})

test("host protocol exchange preserves semantic response mismatches as InvalidOutput", async () => {
  const exchange = createHostProtocolExchange(
    transport({
      recv: async () =>
        new TextEncoder().encode(
          JSON.stringify(
            encodeHostProtocolEnvelope(
              new HostProtocolResponseEnvelope({
                kind: "response",
                id: "other-request",
                timestamp: 1,
                traceId: "trace-1"
              })
            )
          )
        )
    })
  )

  const exit = await Effect.runPromiseExit(exchange.request(request()))

  expectFailure(exit, HostProtocolInvalidOutputError)
  expect(getFailure(exit)).toMatchObject({
    method: "host.ping",
    tag: "InvalidOutput"
  })
})

test("host protocol exchange auto-mints missing host response trace IDs and audits", async () => {
  const rows: EventLogAppend[] = []
  const exchange = createHostProtocolExchange(
    transport({
      recv: async () =>
        new TextEncoder().encode(
          JSON.stringify({
            kind: "response",
            id: "request-1",
            timestamp: 1
          })
        )
    }),
    {
      audit: memoryAudit(rows),
      nextTraceId: () => "trace-auto"
    }
  )

  const response = await Effect.runPromise(exchange.request(request()))

  expect(response.traceId).toBe("trace-auto")
  expect(rows).toEqual([
    {
      type: "audit/trace-id-missing",
      payload: {
        kind: "trace-id-missing",
        source: "HostProtocol",
        traceId: "trace-auto",
        outcome: "auto-minted",
        timestamp: 1,
        details: {
          boundary: "host-runtime",
          envelopeKind: "response",
          requestId: "request-1",
          method: "host.ping"
        }
      }
    }
  ])
})

test("host protocol exchange maps oversized outbound frames to FrameTooLarge", async () => {
  const exchange = createHostProtocolExchange(
    transport({
      send: async () => {
        throw new FrameTooLargeError(9, 8)
      }
    })
  )

  const exit = await Effect.runPromiseExit(exchange.request(request()))

  expectFailure(exit, HostProtocolFrameTooLargeError)
  expect(getFailure(exit)).toMatchObject({
    limitBytes: 8,
    operation: "FramedTransport.send",
    sizeBytes: 9,
    tag: "FrameTooLarge"
  })
})

const request = (): HostProtocolRequestEnvelope =>
  new HostProtocolRequestEnvelope({
    kind: "request",
    id: "request-1",
    method: "host.ping",
    timestamp: 1,
    traceId: "trace-1"
  })

const transport = (overrides: Partial<FramedTransport>): FramedTransport => ({
  send: async () => {
    return
  },
  recv: async () =>
    new TextEncoder().encode(
      JSON.stringify(
        encodeHostProtocolEnvelope(
          new HostProtocolResponseEnvelope({
            kind: "response",
            id: "request-1",
            timestamp: 1,
            traceId: "trace-1"
          })
        )
      )
    ),
  close: async () => {
    return
  },
  ...overrides
})

const memoryAudit = (rows: EventLogAppend[]): EventLogStore => ({
  append: (event: EventLogAppend, _options?: EventLogAppendOptions) =>
    Effect.sync(() => {
      rows.push(event)
      return rows.length
    }),
  query: () => Effect.succeed([]),
  subscribe: () => Stream.empty,
  close: () => Effect.void
})

const expectFailure = (
  exit: Exit.Exit<unknown, unknown>,
  errorClass: abstract new (...args: never[]) => object
): void => {
  const error = getFailure(exit)
  expect(error).toBeInstanceOf(errorClass)
}

const getFailure = (exit: Exit.Exit<unknown, unknown>): unknown => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    return exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error
  }

  return undefined
}
