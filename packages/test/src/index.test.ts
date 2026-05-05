import { expect, test } from "bun:test"
import { Effect } from "effect"

import { makeResourceRegistry, type ResourceId } from "@effect-desktop/core"

import {
  assertNoOpenResourcesIn,
  formatLeakedHandleReport,
  leakedHandles,
  registerLeakMatchers,
  ResourceLeakError
} from "./index.js"

const id = (value: string): ResourceId => value as ResourceId

registerLeakMatchers()

test("assertNoOpenResourcesIn fails with a leaked-handle report", async () => {
  let error: unknown

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* makeResourceRegistry({
          now: () => 1710000000000,
          nextId: () => id("018e2f36-5800-7000-8000-000000000101")
        })
        yield* registry.register({
          kind: "watcher",
          ownerScope: "test-scope",
          state: "open"
        })

        yield* assertNoOpenResourcesIn(registry, {
          testName: "leaky watcher test"
        })
      })
    )
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(ResourceLeakError)
  if (error instanceof ResourceLeakError) {
    expect(error.message).toBe(
      [
        "Leaked resource handles (1) in leaky watcher test",
        "- kind: watcher",
        "  id: 018e2f36-5800-7000-8000-000000000101",
        "  generation: 0",
        "  ownerScope: test-scope",
        "  createdAt: 1710000000000"
      ].join("\n")
    )
  }
})

test("leakedHandles ignores app handles by default", async () => {
  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({
        nextId: () => id("018e2f36-5800-7000-8000-000000000102")
      })
      yield* registry.register({
        kind: "app",
        ownerScope: "app",
        state: "open"
      })

      return yield* registry.list()
    })
  )

  expect(leakedHandles(snapshot)).toEqual([])
})

test("registered matcher renders the leaked-handle report", () => {
  const snapshot = {
    entries: [
      {
        handle: {
          kind: "stream",
          id: id("018e2f36-5800-7000-8000-000000000103"),
          generation: 3,
          ownerScope: "stream-scope",
          state: "open",
          dispose: () => Effect.void
        },
        createdAt: 1710000000001
      }
    ]
  }
  const report = formatLeakedHandleReport(snapshot.entries, "stream leak test")

  expect(() => expect(snapshot).toHaveNoLeakedHandles({ testName: "stream leak test" })).toThrow(
    report
  )
})
