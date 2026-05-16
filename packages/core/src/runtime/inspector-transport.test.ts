import { expect, test } from "bun:test"
import { Clock, Effect, Fiber, Schedule, Stream } from "effect"

import { makeInspectorTransport } from "./inspector-transport.js"

test("InspectorTransport retains a bounded replay window with visible drops", async () => {
  let timestamp = 1_000
  const transport = await Effect.runPromise(
    makeInspectorTransport({
      sessionId: "session-test",
      retentionLimit: 2,
      now: () => timestamp++
    })
  )

  await Effect.runPromise(transport.publish({ source: "telemetry.log", payload: { traceId: "a" } }))
  await Effect.runPromise(transport.publish({ source: "telemetry.log", payload: { traceId: "b" } }))
  await Effect.runPromise(transport.publish({ source: "telemetry.log", payload: { traceId: "c" } }))

  const replayed = await Effect.runPromise(transport.replay())
  const snapshot = await Effect.runPromise(transport.snapshot())

  expect(replayed.map((event) => event.sequence)).toEqual([2, 3])
  expect(replayed.map((event) => event.payload)).toEqual([{ traceId: "b" }, { traceId: "c" }])
  expect(snapshot.retainedEvents).toBe(2)
  expect(snapshot.oldestSequence).toBe(2)
  expect(snapshot.newestSequence).toBe(3)
  expect(snapshot.droppedByRetention).toBe(1)
})

test("InspectorTransport uses the Effect Clock when no explicit clock is supplied", async () => {
  const timestamp = 1_715_000_000_000
  const transport = await Effect.runPromise(
    makeInspectorTransport({ sessionId: "session-clock" }).pipe(
      Effect.provideService(Clock.Clock, fixedClock(timestamp))
    )
  )

  const event = await Effect.runPromise(transport.publish({ source: "clock", payload: null }))

  expect(transport.session.startedAt).toBe(timestamp)
  expect(event.timestampMs).toBe(timestamp)
})

test("InspectorTransport replays after a cursor then streams live events", async () => {
  const transport = await Effect.runPromise(
    makeInspectorTransport({ sessionId: "session-reconnect", retentionLimit: 4 })
  )
  await Effect.runPromise(transport.publish({ source: "bridge.call", payload: "old" }))
  await Effect.runPromise(transport.publish({ source: "bridge.call", payload: "kept" }))

  const observed = Effect.runFork(
    transport.subscribe({ afterSequence: 1 }).pipe(Stream.take(2), Stream.runCollect)
  )
  await Effect.runPromise(Effect.yieldNow)
  await Effect.runPromise(transport.publish({ source: "bridge.call", payload: "live" }))

  const events = Array.from(await Effect.runPromise(Fiber.join(observed)))

  expect(events.map((event) => event.payload)).toEqual(["kept", "live"])
  expect(events.map((event) => event.sessionId)).toEqual(["session-reconnect", "session-reconnect"])
})

test("InspectorTransport removes subscribers when streams are interrupted", async () => {
  const transport = await Effect.runPromise(
    makeInspectorTransport({ sessionId: "session-cleanup" })
  )
  const observed = Effect.runFork(transport.subscribe().pipe(Stream.runDrain))

  await waitFor(
    transport.snapshot().pipe(Effect.map((snapshot) => snapshot.activeSubscribers === 1))
  )
  await Effect.runPromise(Fiber.interrupt(observed))
  await waitFor(
    transport.snapshot().pipe(Effect.map((snapshot) => snapshot.activeSubscribers === 0))
  )
})

test("InspectorTransport counts subscriber backpressure drops", async () => {
  const transport = await Effect.runPromise(
    makeInspectorTransport({
      sessionId: "session-backpressure",
      retentionLimit: 8,
      subscriberBuffer: 1
    })
  )

  await Effect.runPromise(transport.publish({ source: "burst", payload: 1 }))
  await Effect.runPromise(transport.publish({ source: "burst", payload: 2 }))
  await Effect.runPromise(transport.publish({ source: "burst", payload: 3 }))

  const events = await Effect.runPromise(
    transport.subscribe({ limit: 3 }).pipe(Stream.take(1), Stream.runCollect)
  )
  const snapshot = await Effect.runPromise(transport.snapshot())

  expect(events.map((event) => event.payload)).toEqual([1])
  expect(snapshot.droppedBySubscribers).toBe(2)
  expect(snapshot.retainedEvents).toBe(3)
})

test("InspectorTransport rejects invalid retention, replay, and source inputs", async () => {
  const invalidRetention = await Effect.runPromiseExit(
    makeInspectorTransport({ retentionLimit: 0 })
  )
  expect(invalidRetention._tag).toBe("Failure")

  const transport = await Effect.runPromise(
    makeInspectorTransport({ sessionId: "session-invalid" })
  )
  const invalidReplay = await Effect.runPromiseExit(transport.replay({ afterSequence: -1 }))
  const invalidPublish = await Effect.runPromiseExit(
    transport.publish({ source: "", payload: undefined })
  )

  expect(invalidReplay._tag).toBe("Failure")
  expect(invalidPublish._tag).toBe("Failure")
})

const waitFor = async (predicate: Effect.Effect<boolean>): Promise<void> => {
  await Effect.runPromise(
    predicate.pipe(
      Effect.flatMap((matched) =>
        matched ? Effect.void : Effect.fail(new Error("condition not met"))
      ),
      Effect.retry(Schedule.spaced("1 millis").pipe(Schedule.both(Schedule.recurs(100)))),
      Effect.mapError(() => new Error("timed out waiting for condition"))
    )
  )
}

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.void
})
