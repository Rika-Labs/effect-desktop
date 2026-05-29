import { expect, test } from "bun:test"
import type { BridgeStreamRegistry, BridgeStreamRegistryEntry } from "@orika/core"
import { Effect, Fiber, Layer, ManagedRuntime, Ref, Stream } from "effect"

import {
  FiberInspectorCollector,
  FiberInspectorCollectorLive,
  StreamInspectorCollector,
  StreamInspectorCollectorLive,
  type FiberEvent,
  type StreamEvent
} from "./index.js"

const runScoped = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<A, E | LE, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const result = yield* Effect.promise(() => runtime.runPromise(effect))
    yield* Effect.promise(() => runtime.dispose())
    return result
  })

const notImplemented = (): never => {
  throw new Error("not implemented")
}

const fakeRegistry = (
  snapshots: ReadonlyArray<ReadonlyArray<BridgeStreamRegistryEntry>>
): BridgeStreamRegistry => ({
  register: notImplemented,
  terminate: notImplemented,
  isTerminal: notImplemented,
  gcExpired: notImplemented,
  updateBackpressure: notImplemented,
  snapshot: notImplemented,
  observe: () => Stream.fromIterable(snapshots)
})

test("StreamOpened is emitted when a streamId is re-registered as a new generation after going terminal", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const gen0Open: BridgeStreamRegistryEntry = {
        streamId: "s1",
        generation: 0,
        state: "open"
      }
      const gen0Terminal: BridgeStreamRegistryEntry = {
        streamId: "s1",
        generation: 0,
        state: "terminal",
        terminal: "complete",
        terminalAt: 1_000
      }
      const gen1Open: BridgeStreamRegistryEntry = {
        streamId: "s1",
        generation: 1,
        state: "open"
      }
      const registry = fakeRegistry([[gen0Open], [gen0Terminal], [gen1Open]])

      const result = yield* runScoped(
        Effect.gen(function* () {
          const collector = yield* StreamInspectorCollector
          return yield* collector.events().pipe(Stream.runCollect)
        }),
        StreamInspectorCollectorLive(registry)
      )

      const events: ReadonlyArray<StreamEvent> = Array.from(result)

      expect(events).toEqual([
        { _tag: "StreamOpened", streamId: "s1", generation: 0 },
        { _tag: "StreamTerminated", streamId: "s1", generation: 0, terminal: "complete" },
        { _tag: "StreamOpened", streamId: "s1", generation: 1 }
      ])
    })
  ))

test("FiberCompleted is emitted for a fiber that is interrupted because its key was reused", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const collector = yield* FiberInspectorCollector
        const seen = yield* Ref.make<ReadonlyArray<FiberEvent>>([])
        const consumer = yield* collector.events().pipe(
          Stream.runForEach((event) => Ref.update(seen, (prev) => [...prev, event])),
          Effect.forkChild({ startImmediately: true })
        )

        const fiberA = yield* collector.run("k", Effect.never)
        const fiberB = yield* collector.run("k", Effect.never)

        yield* Fiber.await(fiberA)
        yield* Fiber.interrupt(fiberB)

        yield* Effect.replicateEffect(Effect.yieldNow, 8)
        yield* Fiber.interrupt(consumer)

        return {
          events: yield* Ref.get(seen),
          fiberAId: fiberA.id
        }
      }),
      FiberInspectorCollectorLive
    )
  ).then(({ events, fiberAId }) => {
    const startedA = events.filter(
      (event) => event._tag === "FiberStarted" && event.fiberId === fiberAId
    )
    const completedA = events.filter(
      (event) => event._tag === "FiberCompleted" && event.fiberId === fiberAId
    )
    expect(startedA).toHaveLength(1)
    expect(completedA).toHaveLength(1)
  }))
