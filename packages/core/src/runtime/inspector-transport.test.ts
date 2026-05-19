import { expect, test } from "bun:test"
import { Clock, Effect, Fiber, Schedule, Schema, Stream } from "effect"

import { makeInspectorTransport } from "./inspector-transport.js"

test("InspectorTransport retains a bounded replay window with visible drops", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let timestamp = 1_000
      const transport = yield* makeInspectorTransport({
        sessionId: "session-test",
        retentionLimit: 2,
        now: () => timestamp++
      })

      yield* transport.publish({ source: "telemetry.log", payload: { traceId: "a" } })
      yield* transport.publish({ source: "telemetry.log", payload: { traceId: "b" } })
      yield* transport.publish({ source: "telemetry.log", payload: { traceId: "c" } })

      const replayed = yield* transport.replay()
      const snapshot = yield* transport.snapshot()

      expect(replayed.map((event) => event.sequence)).toEqual([2, 3])
      expect(replayed.map((event) => event.payload)).toEqual([{ traceId: "b" }, { traceId: "c" }])
      expect(snapshot.retainedEvents).toBe(2)
      expect(snapshot.oldestSequence).toBe(2)
      expect(snapshot.newestSequence).toBe(3)
      expect(snapshot.droppedByRetention).toBe(1)
    })
  ))

test("InspectorTransport uses the Effect Clock when no explicit clock is supplied", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const timestamp = 1_715_000_000_000
      const transport = yield* makeInspectorTransport({ sessionId: "session-clock" }).pipe(
        Effect.provideService(Clock.Clock, fixedClock(timestamp))
      )

      const event = yield* transport.publish({ source: "clock", payload: null })

      expect(transport.session.startedAt).toBe(timestamp)
      expect(event.timestampMs).toBe(timestamp)
    })
  ))

test("InspectorTransport replays after a cursor then streams live events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const transport = yield* makeInspectorTransport({
        sessionId: "session-reconnect",
        retentionLimit: 4
      })
      yield* transport.publish({ source: "bridge.call", payload: "old" })
      yield* transport.publish({ source: "bridge.call", payload: "kept" })

      const observed = yield* Effect.forkChild(
        transport.subscribe({ afterSequence: 1 }).pipe(Stream.take(2), Stream.runCollect),
        { startImmediately: true }
      )
      yield* Effect.yieldNow
      yield* transport.publish({ source: "bridge.call", payload: "live" })

      const events = Array.from(yield* Fiber.join(observed))

      expect(events.map((event) => event.payload)).toEqual(["kept", "live"])
      expect(events.map((event) => event.sessionId)).toEqual([
        "session-reconnect",
        "session-reconnect"
      ])
    })
  ))

test("InspectorTransport removes subscribers when streams are interrupted", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const transport = yield* makeInspectorTransport({ sessionId: "session-cleanup" })
      const observed = yield* Effect.forkChild(transport.subscribe().pipe(Stream.runDrain), {
        startImmediately: true
      })

      yield* waitFor(
        transport.snapshot().pipe(Effect.map((snapshot) => snapshot.activeSubscribers === 1))
      )
      yield* Fiber.interrupt(observed)
      yield* waitFor(
        transport.snapshot().pipe(Effect.map((snapshot) => snapshot.activeSubscribers === 0))
      )
    })
  ))

test("InspectorTransport counts subscriber backpressure drops", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const transport = yield* makeInspectorTransport({
        sessionId: "session-backpressure",
        retentionLimit: 8,
        subscriberBuffer: 1
      })

      yield* transport.publish({ source: "burst", payload: 1 })
      yield* transport.publish({ source: "burst", payload: 2 })
      yield* transport.publish({ source: "burst", payload: 3 })

      const events = yield* transport
        .subscribe({ limit: 3 })
        .pipe(Stream.take(1), Stream.runCollect)
      const snapshot = yield* transport.snapshot()

      expect(events.map((event) => event.payload)).toEqual([1])
      expect(snapshot.droppedBySubscribers).toBe(2)
      expect(snapshot.retainedEvents).toBe(3)
    })
  ))

test("InspectorTransport rejects invalid retention, replay, and source inputs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidRetention = yield* Effect.exit(makeInspectorTransport({ retentionLimit: 0 }))
      expect(invalidRetention._tag).toBe("Failure")

      const transport = yield* makeInspectorTransport({ sessionId: "session-invalid" })
      const invalidReplay = yield* Effect.exit(transport.replay({ afterSequence: -1 }))
      const invalidPublish = yield* Effect.exit(
        transport.publish({ source: "", payload: undefined })
      )

      expect(invalidReplay._tag).toBe("Failure")
      expect(invalidPublish._tag).toBe("Failure")
    })
  ))

class InspectorWaitForFailed extends Schema.TaggedErrorClass<InspectorWaitForFailed>()(
  "InspectorWaitForFailed",
  {}
) {}

const waitFor = (predicate: Effect.Effect<boolean>): Effect.Effect<void, InspectorWaitForFailed> =>
  predicate.pipe(
    Effect.flatMap(
      (matched): Effect.Effect<void, InspectorWaitForFailed> =>
        matched ? Effect.void : Effect.fail(new InspectorWaitForFailed())
    ),
    Effect.retry(Schedule.spaced("1 millis").pipe(Schedule.both(Schedule.recurs(100)))),
    Effect.mapError(() => new InspectorWaitForFailed())
  )

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.void
})
