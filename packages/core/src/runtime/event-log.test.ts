import { expect, test } from "bun:test"
import { Effect, Fiber, Layer, Stream } from "effect"

import {
  DesktopEventLog,
  DesktopEventLogEvent,
  DesktopEventLogLive,
  DesktopEventLogNoopInspectorLive
} from "./event-log.js"
import {
  EventLogInspectorCollector,
  EventLogInspectorEvent,
  makeInspectorCollectors
} from "./inspector-events.js"

const testLayer = DesktopEventLogLive({ maxQueryEntries: 2 }).pipe(
  Layer.provide(DesktopEventLogNoopInspectorLive)
)

test("DesktopEventLog appends closed desktop policy events through Effect EventLog", async () => {
  const entries = await Effect.runPromise(
    Effect.gen(function* () {
      const eventLog = yield* DesktopEventLog
      yield* eventLog.append(
        new DesktopEventLogEvent({
          kind: "append",
          status: "success",
          operation: "EventLog.append",
          event: "audit/permission-granted",
          primaryKey: "trace-1",
          traceId: "trace-1",
          payloadBytes: 12,
          timestamp: 1_715_000_000_000
        })
      )

      return yield* eventLog.query()
    }).pipe(Effect.provide(testLayer))
  )

  expect(entries).toHaveLength(1)
  expect(entries[0]?.event).toBe("desktop-event-log")
  expect(entries[0]?.primaryKey).toBe("trace-1")
  expect(entries[0]?.payload.operation).toBe("EventLog.append")
})

test("DesktopEventLog query caps retained results at policy limit", async () => {
  const entries = await Effect.runPromise(
    Effect.gen(function* () {
      const eventLog = yield* DesktopEventLog
      for (const index of [1, 2, 3]) {
        yield* eventLog.append(
          new DesktopEventLogEvent({
            kind: "query",
            status: "success",
            operation: "EventLog.query",
            traceId: `trace-${index}`,
            timestamp: 1_715_000_000_000 + index
          })
        )
      }

      return yield* eventLog.query({ kind: "query", limit: 50 })
    }).pipe(Effect.provide(testLayer))
  )

  expect(entries.map((entry) => entry.primaryKey)).toEqual(["trace-2", "trace-3"])
  expect(entries.every((entry) => entry.payload.kind === "query")).toBe(true)
})

test("DesktopEventLog publishes typed Inspector events", async () => {
  const event = await Effect.runPromise(
    Effect.gen(function* () {
      const collectors = yield* makeInspectorCollectors()
      const layer = DesktopEventLogLive().pipe(
        Layer.provide(Layer.succeed(EventLogInspectorCollector, collectors.eventLog))
      )
      const fiber = yield* collectors.eventLog.events.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true })
      )

      yield* Effect.gen(function* () {
        const eventLog = yield* DesktopEventLog
        yield* eventLog.append(
          new DesktopEventLogEvent({
            kind: "recovery",
            status: "success",
            operation: "EventLog.recover",
            namespace: "audit",
            message: "replayed retained journal entries",
            timestamp: 1_715_000_000_000
          })
        )
      }).pipe(Effect.provide(layer))

      const events = yield* Fiber.join(fiber)
      return events[0]
    })
  )

  expect(event).toBeInstanceOf(EventLogInspectorEvent)
  expect(event?.kind).toBe("recovery")
  expect(event?.operation).toBe("EventLog.recover")
})

test("DesktopEventLog exposes read-only transitions as typed Inspector events", async () => {
  const event = await Effect.runPromise(
    Effect.gen(function* () {
      const collectors = yield* makeInspectorCollectors()
      const layer = DesktopEventLogLive().pipe(
        Layer.provide(Layer.succeed(EventLogInspectorCollector, collectors.eventLog))
      )
      const fiber = yield* collectors.eventLog.events.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true })
      )

      yield* Effect.gen(function* () {
        const eventLog = yield* DesktopEventLog
        yield* eventLog.append(
          new DesktopEventLogEvent({
            kind: "read-only-transition",
            status: "success",
            operation: "EventLog.readOnly",
            namespace: "audit",
            message: "journal switched to read-only after disk full",
            timestamp: 1_715_000_000_001
          })
        )
      }).pipe(Effect.provide(layer))

      const events = yield* Fiber.join(fiber)
      return events[0]
    })
  )

  expect(event).toBeInstanceOf(EventLogInspectorEvent)
  expect(event?.kind).toBe("read-only-transition")
  expect(event?.operation).toBe("EventLog.readOnly")
})
