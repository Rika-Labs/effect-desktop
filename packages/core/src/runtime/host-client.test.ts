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
import { Effect, Exit } from "effect"

import { AuditEvent, type AuditEventsApi } from "./audit-events.js"
import { createHostProtocolExchange } from "./host-client.js"
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

test("host protocol exchange rejects invalid UTF-8 in response frames", async () => {
  const prefix = new TextEncoder().encode(
    '{"kind":"response","id":"request-1","timestamp":1,"traceId":"trace-'
  )
  const suffix = new TextEncoder().encode('"}')
  const frame = new Uint8Array(prefix.length + 1 + suffix.length)
  frame.set(prefix)
  frame[prefix.length] = 0xff
  frame.set(suffix, prefix.length + 1)

  const exchange = createHostProtocolExchange(
    transport({
      recv: async () => frame
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

test("host protocol exchange rejects response trace id mismatches", async () => {
  const exchange = createHostProtocolExchange(
    transport({
      recv: async () =>
        new TextEncoder().encode(
          JSON.stringify(
            encodeHostProtocolEnvelope(
              new HostProtocolResponseEnvelope({
                kind: "response",
                id: "request-1",
                timestamp: 1,
                traceId: "trace-other"
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
  const rows: AuditEvent[] = []
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
  expect(rows).toHaveLength(1)
  expect(rows[0]).toBeInstanceOf(AuditEvent)
  expect(rows[0]?.kind).toBe("trace-id-missing")
  expect(rows[0]?.source).toBe("HostProtocol")
  expect(rows[0]?.traceId).toBe("trace-auto")
  expect(rows[0]?.outcome).toBe("auto-minted")
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

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    })
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
