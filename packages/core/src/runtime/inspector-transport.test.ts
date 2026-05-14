import { expect, test } from "bun:test"
import { Effect, Fiber, Stream } from "effect"

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

test("InspectorTransport replays after a cursor then streams live events", async () => {
  const transport = await Effect.runPromise(
    makeInspectorTransport({ sessionId: "session-reconnect", retentionLimit: 4 })
  )
  await Effect.runPromise(transport.publish({ source: "bridge.call", payload: "old" }))
  await Effect.runPromise(transport.publish({ source: "bridge.call", payload: "kept" }))

  const observed = Effect.runFork(
    transport.subscribe({ afterSequence: 1 }).pipe(Stream.take(2), Stream.runCollect)
  )
  await Bun.sleep(0)
  await Effect.runPromise(transport.publish({ source: "bridge.call", payload: "live" }))

  const events = Array.from(await Effect.runPromise(Fiber.join(observed)))

  expect(events.map((event) => event.payload)).toEqual(["kept", "live"])
  expect(events.map((event) => event.sessionId)).toEqual(["session-reconnect", "session-reconnect"])
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
