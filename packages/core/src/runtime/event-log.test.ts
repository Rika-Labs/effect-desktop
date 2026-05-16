import { expect, test } from "bun:test"
import { Cause, Clock, Effect, Exit, Fiber, Layer, Stream } from "effect"
import { EventJournal, EventLog as EffectEventLog } from "effect/unstable/eventlog"

import {
  DesktopEventLog,
  DesktopEventLogEvent,
  DesktopEventLogLive,
  DesktopEventLogNoopInspectorLive,
  makeDesktopEventLog
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

test("DesktopEventLog query Inspector events use the Effect Clock", async () => {
  const timestamp = 1_715_000_999_000
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
        yield* eventLog.query()
      }).pipe(Effect.provide(layer), Effect.provideService(Clock.Clock, fixedClock(timestamp)))

      const events = yield* Fiber.join(fiber)
      return events[0]
    })
  )

  expect(event).toBeInstanceOf(EventLogInspectorEvent)
  expect(event?.kind).toBe("query")
  expect(event?.timestamp).toBe(timestamp)
})

test("DesktopEventLog query failure publishes Inspector event and preserves journal error", async () => {
  const timestamp = 1_715_000_999_001
  const journalError = new EventJournal.EventJournalError({
    cause: "boom",
    method: "entries"
  })
  const collectors = await Effect.runPromise(makeInspectorCollectors())
  const eventLog = await Effect.runPromise(
    makeDesktopEventLog(failingEventLog(journalError), collectors.eventLog)
  )
  const fiber = Effect.runFork(collectors.eventLog.events.pipe(Stream.take(1), Stream.runCollect))

  const exit = await Effect.runPromiseExit(
    eventLog.query().pipe(Effect.provideService(Clock.Clock, fixedClock(timestamp)))
  )
  const events = [...(await Effect.runPromise(Fiber.join(fiber)))]

  expectFailure(exit, EventJournal.EventJournalError)
  expect(events[0]).toMatchObject({
    errorTag: "EventJournalError",
    kind: "query",
    message: "entries failed",
    operation: "DesktopEventLog.query",
    status: "failure",
    timestamp
  })
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

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.void
})

const failingEventLog = (
  error: EventJournal.EventJournalError
): EffectEventLog.EventLog["Service"] =>
  Object.freeze({
    destroy: Effect.fail(error),
    entries: Effect.fail(error),
    write: () => Effect.fail(error)
  } satisfies EffectEventLog.EventLog["Service"])

const expectFailure = (
  exit: Exit.Exit<unknown, EventJournal.EventJournalError>,
  errorType: abstract new (...args: never[]) => unknown
): void => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)
    expect(fail?.error).toBeInstanceOf(errorType)
  }
}
