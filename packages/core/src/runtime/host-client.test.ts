import { expect, test } from "bun:test"
import {
  HostProtocolBinaryDecodeError,
  HostProtocolFrameTooLargeError,
  HostProtocolHostUnavailableError,
  HostProtocolInvalidOutputError,
  HostProtocolEventEnvelope,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  encodeHostProtocolEnvelope
} from "@orika/bridge"
import { Effect, Exit, Fiber, Option, Queue, Schema, Stream } from "effect"

import { AuditEvent, type AuditEventsApi } from "./audit-events.js"
import { createHostProtocolExchange } from "./host-client.js"
import {
  TransportFrameTooLargeError,
  TransportFrameTruncatedError,
  type TransportConnection
} from "./transport.js"

const encodeUnknownJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

test("host protocol exchange maps oversized received frames to FrameTooLarge", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange = createHostProtocolExchange(
        transport({
          receive: Stream.fail(
            new TransportFrameTooLargeError({
              operation: "TransportConnection.receive",
              size: 5,
              max: 4
            })
          )
        })
      )

      const exit = yield* Effect.exit(exchange.request(request()))
      const failure = getFailure(exit)

      expect(failure).toBeInstanceOf(HostProtocolFrameTooLargeError)
      expect(failure).toMatchObject({
        limitBytes: 4,
        operation: "TransportConnection.receive",
        sizeBytes: 5,
        tag: "FrameTooLarge"
      })
    })
  ))

test("host protocol exchange maps truncated received frames to BinaryDecodeError", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange = createHostProtocolExchange(
        transport({
          receive: Stream.fail(
            new TransportFrameTruncatedError({
              operation: "TransportConnection.receive",
              stage: "body",
              expected: 8,
              read: 2
            })
          )
        })
      )

      const exit = yield* Effect.exit(exchange.request(request()))
      const failure = getFailure(exit)

      expect(failure).toBeInstanceOf(HostProtocolBinaryDecodeError)
      expect(failure).toMatchObject({
        operation: "TransportConnection.receive",
        tag: "BinaryDecodeError"
      })
    })
  ))

test("host protocol exchange maps closed host transport to HostUnavailable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange = createHostProtocolExchange(
        transport({
          receive: Stream.empty
        })
      )

      const exit = yield* Effect.exit(exchange.request(request()))
      const failure = getFailure(exit)

      expect(failure).toBeInstanceOf(HostProtocolHostUnavailableError)
      expect(failure).toMatchObject({
        operation: "TransportConnection.receive",
        tag: "HostUnavailable"
      })
    })
  ))

test("host protocol exchange maps malformed JSON frames to BinaryDecodeError", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange = createHostProtocolExchange(
        transport({
          receive: Stream.make(new TextEncoder().encode("{"))
        })
      )

      const exit = yield* Effect.exit(exchange.request(request()))
      const failure = getFailure(exit)

      expect(failure).toBeInstanceOf(HostProtocolBinaryDecodeError)
      expect(failure).toMatchObject({
        operation: "host.ping",
        tag: "BinaryDecodeError"
      })
    })
  ))

test("host protocol exchange rejects invalid UTF-8 in response frames", () =>
  Effect.runPromise(
    Effect.gen(function* () {
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
          receive: Stream.make(frame)
        })
      )

      const exit = yield* Effect.exit(exchange.request(request()))
      const failure = getFailure(exit)

      expect(failure).toBeInstanceOf(HostProtocolBinaryDecodeError)
      expect(failure).toMatchObject({
        operation: "host.ping",
        tag: "BinaryDecodeError"
      })
    })
  ))

test("host protocol exchange preserves decoded envelope shape failures as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange = createHostProtocolExchange(
        transport({
          receive: Stream.make(new TextEncoder().encode(encodeUnknownJson({ kind: "response" })))
        })
      )

      const exit = yield* Effect.exit(exchange.request(request()))
      const failure = getFailure(exit)

      expect(failure).toBeInstanceOf(HostProtocolInvalidOutputError)
      expect(failure).toMatchObject({
        method: "host.ping",
        tag: "InvalidOutput"
      })
    })
  ))

test("host protocol exchange preserves semantic response mismatches as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange = createHostProtocolExchange(
        transport({
          receive: Stream.make(
            new TextEncoder().encode(
              encodeUnknownJson(
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
          )
        })
      )

      const exit = yield* Effect.exit(exchange.request(request()))

      expectFailure(exit, HostProtocolInvalidOutputError)
      expect(exit.pipe(getFailure)).toMatchObject({
        method: "host.ping",
        tag: "InvalidOutput"
      })
    })
  ))

test("host protocol exchange rejects response trace id mismatches", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange = createHostProtocolExchange(
        transport({
          receive: Stream.make(
            new TextEncoder().encode(
              encodeUnknownJson(
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
          )
        })
      )

      const exit = yield* Effect.exit(exchange.request(request()))

      expectFailure(exit, HostProtocolInvalidOutputError)
      expect(exit.pipe(getFailure)).toMatchObject({
        method: "host.ping",
        tag: "InvalidOutput"
      })
    })
  ))

test("host protocol exchange auto-mints missing host response trace IDs and audits", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const exchange = createHostProtocolExchange(
        transport({
          receive: Stream.make(
            new TextEncoder().encode(
              encodeUnknownJson({
                kind: "response",
                id: "request-1",
                timestamp: 9
              })
            )
          )
        }),
        {
          audit: memoryAudit(rows),
          nextTraceId: () => "trace-auto"
        }
      )

      const response = yield* exchange.request(request())

      expect(response.traceId).toBe("trace-auto")
      expect(rows).toHaveLength(1)
      expect(rows[0]).toBeInstanceOf(AuditEvent)
      expect(rows[0]?.kind).toBe("trace-id-missing")
      expect(rows[0]?.source).toBe("HostProtocol")
      expect(rows[0]?.traceId).toBe("trace-auto")
      expect(rows[0]?.outcome).toBe("auto-minted")
      expect(rows[0]?.timestamp).toBe(9)
      expect(rows[0]?.details).toMatchObject({
        method: "host.ping",
        requestId: "request-1"
      })
    })
  ))

test("host protocol exchange rejects invalid minted trace IDs before auditing", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const exchange = createHostProtocolExchange(
        transport({
          receive: Stream.make(
            new TextEncoder().encode(
              encodeUnknownJson({
                kind: "response",
                id: "request-1",
                timestamp: 9
              })
            )
          )
        }),
        {
          audit: memoryAudit(rows),
          nextTraceId: () => ""
        }
      )

      const exit = yield* Effect.exit(exchange.request(request()))

      expectFailure(exit, HostProtocolInvalidOutputError)
      expect(exit.pipe(getFailure)).toMatchObject({
        method: "host.ping",
        tag: "InvalidOutput"
      })
      expect(rows).toEqual([])
    })
  ))

test("host protocol exchange routes native events before the matching response", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const inbound = yield* Queue.unbounded<Uint8Array>()
      const event = new HostProtocolEventEnvelope({
        kind: "event",
        method: "EgressPolicy.DecisionRecorded",
        timestamp: 1,
        traceId: "trace-1",
        payload: { type: "decision-recorded" }
      })
      const response = new HostProtocolResponseEnvelope({
        kind: "response",
        id: "request-1",
        timestamp: 2,
        traceId: "trace-1"
      })
      yield* Queue.offer(inbound, frame(event))
      yield* Queue.offer(inbound, frame(response))
      const exchange = createHostProtocolExchange(
        transport({
          receive: Stream.fromQueue(inbound)
        })
      )

      const first = yield* exchange.request(request())
      const eventStream = exchange.subscribe?.("EgressPolicy.DecisionRecorded")
      expect(eventStream).toBeDefined()
      const observed = yield* (eventStream ?? Stream.die("subscription should be supported")).pipe(
        Stream.runHead,
        Effect.map(Option.getOrThrow)
      )
      expect(first.id).toBe("request-1")
      expect(observed.method).toBe("EgressPolicy.DecisionRecorded")
    })
  ))

test("host protocol exchange starts event reads only when the event stream is consumed", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let reads = 0
      const inbound = yield* Queue.unbounded<Uint8Array>()
      const event = new HostProtocolEventEnvelope({
        kind: "event",
        method: "EgressPolicy.DecisionRecorded",
        timestamp: 1,
        traceId: "trace-1",
        payload: { type: "decision-recorded" }
      })
      const exchange = createHostProtocolExchange(
        transport({
          receive: Stream.fromQueue(inbound).pipe(
            Stream.map((frame) => {
              reads += 1
              return frame
            })
          )
        })
      )

      const eventStream = exchange.subscribe?.("EgressPolicy.DecisionRecorded")
      expect(eventStream).toBeDefined()
      expect(reads).toBe(0)
      yield* Queue.offer(inbound, frame(event))

      const observed = yield* (eventStream ?? Stream.die("subscription should be supported")).pipe(
        Stream.runHead,
        Effect.map(Option.getOrThrow)
      )

      expect(observed.method).toBe("EgressPolicy.DecisionRecorded")
      expect(reads).toBe(1)
    })
  ))

test("host protocol exchange close interrupts active event reads and closes transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let closed = 0
      const exchange = createHostProtocolExchange(
        transport({
          receive: Stream.never,
          close: () =>
            Effect.sync(() => {
              closed += 1
            })
        })
      )
      const eventStream = exchange.subscribe?.("EgressPolicy.DecisionRecorded")
      expect(eventStream).toBeDefined()
      const fiber = yield* Effect.forkChild(
        (eventStream ?? Stream.die("subscription should be supported")).pipe(Stream.runDrain),
        { startImmediately: true }
      )

      yield* exchange.close?.() ?? Effect.void
      yield* Fiber.interrupt(fiber)

      expect(closed).toBeGreaterThanOrEqual(1)
    })
  ))

test("host protocol exchange routes native events after a completed request", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const inbound = yield* Queue.unbounded<Uint8Array>()
      const sent = yield* Queue.unbounded<void>()
      const response = new HostProtocolResponseEnvelope({
        kind: "response",
        id: "request-1",
        timestamp: 1,
        traceId: "trace-1"
      })
      const event = new HostProtocolEventEnvelope({
        kind: "event",
        method: "EgressPolicy.DecisionRecorded",
        timestamp: 2,
        traceId: "trace-1",
        payload: { type: "decision-recorded" }
      })
      const exchange = createHostProtocolExchange(
        transport({
          send: () => Queue.offer(sent, undefined),
          receive: Stream.fromQueue(inbound)
        })
      )

      const eventStream = exchange.subscribe?.("EgressPolicy.DecisionRecorded")
      expect(eventStream).toBeDefined()
      const firstFiber = yield* Effect.forkChild(exchange.request(request()), {
        startImmediately: true
      })
      yield* Queue.take(sent)
      yield* Queue.offer(inbound, frame(response))
      const first = yield* Fiber.join(firstFiber)
      yield* Queue.offer(inbound, frame(event))
      const observed = yield* (eventStream ?? Stream.die("subscription should be supported")).pipe(
        Stream.runHead,
        Effect.map(Option.getOrThrow),
        Effect.timeout("100 millis")
      )

      expect(first.id).toBe("request-1")
      expect(observed.method).toBe("EgressPolicy.DecisionRecorded")
    })
  ))

test("host protocol exchange routes out-of-order responses by request id", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const inbound = yield* Queue.unbounded<Uint8Array>()
      const sent = yield* Queue.unbounded<void>()
      const exchange = createHostProtocolExchange(
        transport({
          send: () => Queue.offer(sent, undefined),
          receive: Stream.fromQueue(inbound)
        })
      )
      const requestTwo = new HostProtocolRequestEnvelope({
        kind: "request",
        id: "request-2",
        method: "host.ping",
        timestamp: 2,
        traceId: "trace-2"
      })
      const firstFiber = yield* Effect.forkChild(exchange.request(request()), {
        startImmediately: true
      })
      const secondFiber = yield* Effect.forkChild(exchange.request(requestTwo), {
        startImmediately: true
      })
      yield* Queue.take(sent)
      yield* Queue.take(sent)

      yield* Queue.offer(
        inbound,
        frame(
          new HostProtocolResponseEnvelope({
            kind: "response",
            id: "request-2",
            timestamp: 3,
            traceId: "trace-2"
          })
        )
      )
      yield* Queue.offer(
        inbound,
        frame(
          new HostProtocolResponseEnvelope({
            kind: "response",
            id: "request-1",
            timestamp: 4,
            traceId: "trace-1"
          })
        )
      )

      const [first, second] = yield* Effect.all([Fiber.join(firstFiber), Fiber.join(secondFiber)])

      expect(first.id).toBe("request-1")
      expect(second.id).toBe("request-2")
    })
  ))

test("host protocol exchange fails active event streams when the host reader fails", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange = createHostProtocolExchange(
        transport({
          receive: Stream.fail(
            new TransportFrameTruncatedError({
              operation: "TransportConnection.receive",
              stage: "body",
              expected: 8,
              read: 2
            })
          )
        })
      )
      const eventStream = exchange.subscribe?.("EgressPolicy.DecisionRecorded")
      expect(eventStream).toBeDefined()

      const exit = yield* Effect.exit(
        (eventStream ?? Stream.die("subscription should be supported")).pipe(Stream.runHead)
      )

      expectFailure(exit, HostProtocolBinaryDecodeError)
      expect(exit.pipe(getFailure)).toMatchObject({
        operation: "TransportConnection.receive",
        tag: "BinaryDecodeError"
      })
    })
  ))

test("host protocol exchange fails new event streams after the host reader is fatal", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange = createHostProtocolExchange(
        transport({
          receive: Stream.empty
        })
      )
      yield* Effect.exit(exchange.request(request()))
      const eventStream = exchange.subscribe?.("EgressPolicy.DecisionRecorded")
      expect(eventStream).toBeDefined()

      const exit = yield* Effect.exit(
        (eventStream ?? Stream.die("subscription should be supported")).pipe(Stream.runHead)
      )

      expectFailure(exit, HostProtocolHostUnavailableError)
      expect(exit.pipe(getFailure)).toMatchObject({
        operation: "TransportConnection.receive",
        tag: "HostUnavailable"
      })
    })
  ))

test("host protocol exchange maps oversized outbound frames to FrameTooLarge", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange = createHostProtocolExchange(
        transport({
          send: () =>
            Effect.fail(
              new TransportFrameTooLargeError({
                operation: "TransportConnection.send",
                size: 9,
                max: 8
              })
            )
        })
      )

      const exit = yield* Effect.exit(exchange.request(request()))

      expectFailure(exit, HostProtocolFrameTooLargeError)
      expect(exit.pipe(getFailure)).toMatchObject({
        limitBytes: 8,
        operation: "TransportConnection.send",
        sizeBytes: 9,
        tag: "FrameTooLarge"
      })
    })
  ))

const request = (): HostProtocolRequestEnvelope =>
  new HostProtocolRequestEnvelope({
    kind: "request",
    id: "request-1",
    method: "host.ping",
    timestamp: 1,
    traceId: "trace-1"
  })

const transport = (overrides: Partial<TransportConnection>): TransportConnection => ({
  send: () => Effect.void,
  receive: Stream.make(
    new TextEncoder().encode(
      encodeUnknownJson(
        encodeHostProtocolEnvelope(
          new HostProtocolResponseEnvelope({
            kind: "response",
            id: "request-1",
            timestamp: 1,
            traceId: "trace-1"
          })
        )
      )
    )
  ),
  close: () => Effect.void,
  ...overrides
})

const frame = (envelope: HostProtocolEventEnvelope | HostProtocolResponseEnvelope): Uint8Array =>
  new TextEncoder().encode(encodeUnknownJson(encodeHostProtocolEnvelope(envelope)))

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.empty
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
