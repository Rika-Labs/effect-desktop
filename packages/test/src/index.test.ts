import { expect, test } from "bun:test"
import { Effect } from "effect"

import {
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD,
  makeHostProtocolNotFoundError
} from "@effect-desktop/bridge"
import { makeResourceRegistry, type ResourceId } from "@effect-desktop/core"

import {
  assertNoOpenResourcesIn,
  formatLeakedHandleReport,
  leakedHandles,
  registerLeakMatchers,
  runHeadless,
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

test("leakedHandles ignores app handles by default without exempting app-owned resources", async () => {
  const ids = [
    id("018e2f36-5800-7000-8000-000000000102"),
    id("018e2f36-5800-7000-8000-000000000104")
  ]
  let nextIdIndex = 0
  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({
        nextId: () => ids[nextIdIndex++] ?? id("018e2f36-5800-7000-8000-000000000105")
      })
      yield* registry.register({
        kind: "app",
        ownerScope: "app",
        state: "open"
      })
      const window = yield* registry.register({
        kind: "window",
        ownerScope: "app",
        state: "open"
      })

      return {
        snapshot: yield* registry.list(),
        window
      }
    })
  )

  expect(leakedHandles(snapshot.snapshot).map((entry) => entry.handle.id)).toEqual([
    snapshot.window.id
  ])
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

test("runHeadless records host calls and exits without leaked windows", async () => {
  const result = await Effect.runPromise(
    runHeadless(
      (runtime) =>
        Effect.gen(function* () {
          yield* runtime.handshake.ping()
          const version = yield* runtime.handshake.version()
          const window = yield* runtime.window.create({ title: "Headless" })
          yield* runtime.window.destroy(window.windowId)

          return {
            calls: runtime.calls().map((call) => call.method),
            protocolVersion: version.protocolVersion
          }
        }),
      {
        nextRequestId: nextSequence("request"),
        nextTraceId: nextSequence("trace"),
        now: () => 1710000000100
      }
    )
  )

  expect(result.calls).toEqual([
    "host.ping",
    "host.version",
    WINDOW_CREATE_METHOD,
    WINDOW_DESTROY_METHOD
  ])
  expect(result.protocolVersion).toBe("0.0.0")
})

test("runHeadless fails when a headless window is left open", async () => {
  let error: unknown

  try {
    await Effect.runPromise(
      runHeadless(
        (runtime) =>
          Effect.gen(function* () {
            yield* runtime.window.create({ title: "Leaked" })
          }),
        {
          nextRequestId: nextSequence("request"),
          nextTraceId: nextSequence("trace"),
          now: () => 1710000000200
        }
      )
    )
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(ResourceLeakError)
  if (error instanceof ResourceLeakError) {
    expect(error.message).toContain("kind: window")
    expect(error.message).toContain("ownerScope: headless")
  }
})

test("runHeadless preserves typed destroy errors from the mock host", async () => {
  const result = await Effect.runPromise(
    runHeadless(
      (runtime) =>
        Effect.gen(function* () {
          const window = yield* runtime.window.create({ title: "Destroy failure" })
          const destroyExit = yield* Effect.exit(runtime.window.destroy(window.windowId))
          yield* runtime.registry.closeScope("headless")

          return destroyExit
        }),
      {
        fixtures: {
          [WINDOW_DESTROY_METHOD]: () =>
            Effect.fail(makeHostProtocolNotFoundError("headless-window", WINDOW_DESTROY_METHOD))
        },
        nextRequestId: nextSequence("request"),
        nextTraceId: nextSequence("trace"),
        now: () => 1710000000300
      }
    )
  )

  expect(result._tag).toBe("Failure")
  if (result._tag === "Failure") {
    expect(JSON.stringify(result.cause.toJSON())).toContain("NotFound")
  }
})

const nextSequence = (prefix: string): (() => string) => {
  let next = 0

  return () => `${prefix}-${next++}`
}
