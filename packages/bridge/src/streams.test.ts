import { expect, test } from "bun:test"
import { Effect } from "effect"

import { makeBridgeStreamRegistry } from "./streams.js"

test("stream registry starts at generation 0 and bumps on re-registration within the grace window", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeBridgeStreamRegistry(1_000)

      const first = yield* registry.register("s1")
      expect(first.generation).toBe(0)
      expect(first.state).toBe("open")

      yield* registry.terminate("s1", "complete", 0)
      const second = yield* registry.register("s1")
      expect(second.generation).toBe(1)
    })
  ))

test("gcExpired removes terminal entries past the grace period and prunes their generation bookkeeping", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeBridgeStreamRegistry(1_000)

      yield* registry.register("s1")
      yield* registry.terminate("s1", "complete", 0)

      const removed = yield* registry.gcExpired(2_000)
      expect(removed).toBe(1)

      const afterGc = yield* registry.snapshot()
      expect(afterGc).toEqual([])

      const reborn = yield* registry.register("s1")
      expect(reborn.generation).toBe(0)
    })
  ))

test("gcExpired keeps terminal entries still inside the grace period", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeBridgeStreamRegistry(1_000)

      yield* registry.register("s1")
      yield* registry.terminate("s1", "complete", 0)

      const removed = yield* registry.gcExpired(500)
      expect(removed).toBe(0)

      const snapshot = yield* registry.snapshot()
      expect(snapshot.map((entry) => entry.streamId)).toEqual(["s1"])
    })
  ))
