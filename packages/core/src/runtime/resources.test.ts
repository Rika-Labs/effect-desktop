import { expect, test } from "bun:test"
import { Effect, Option, Stream } from "effect"

import {
  generateUuidV7,
  makeResourceRegistry,
  ResourceRegistry,
  ResourceRegistryLive,
  type ResourceId
} from "./resources.js"

const id = (value: string): ResourceId => value as ResourceId

test("register returns handles and list enumerates live resources", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({
        now: () => 1710000000000,
        nextId: () => id("018e2f36-5800-7000-8000-000000000001")
      })
      const handle = yield* registry.register({
        kind: "process",
        ownerScope: "scope-test",
        state: "running"
      })
      const snapshot = yield* registry.list()

      return { handle, snapshot }
    })
  )

  expect(result.handle).toMatchObject({
    kind: "process",
    id: "018e2f36-5800-7000-8000-000000000001",
    generation: 0,
    ownerScope: "scope-test",
    state: "running"
  })
  expect(result.snapshot.entries.map((entry) => entry.handle.id)).toEqual([result.handle.id])
  expect(result.snapshot.entries[0]?.createdAt).toBe(1710000000000)
})

test("get returns the matching live resource", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({
        nextId: () => id("018e2f36-5800-7000-8000-000000000002")
      })
      const handle = yield* registry.register({
        kind: "window",
        ownerScope: "scope-window",
        state: "open"
      })

      return yield* registry.get(handle.id)
    })
  )

  expect(Option.isSome(result)).toBe(true)
  if (Option.isSome(result)) {
    expect(result.value.handle.kind).toBe("window")
  }
})

test("dispose runs cleanup once and removes the resource", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      let cleanupCount = 0
      const registry = yield* makeResourceRegistry({
        nextId: () => id("018e2f36-5800-7000-8000-000000000003")
      })
      const handle = yield* registry.register({
        kind: "stream",
        ownerScope: "scope-stream",
        state: "open",
        dispose: Effect.sync(() => {
          cleanupCount += 1
        })
      })

      yield* registry.dispose(handle.id)
      yield* registry.dispose(handle.id)
      const snapshot = yield* registry.list()

      return { cleanupCount, snapshot }
    })
  )

  expect(result.cleanupCount).toBe(1)
  expect(result.snapshot.entries).toEqual([])
})

test("handle dispose delegates to the registry", async () => {
  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({
        nextId: () => id("018e2f36-5800-7000-8000-000000000004")
      })
      const handle = yield* registry.register({
        kind: "fileWatcher",
        ownerScope: "scope-files",
        state: "watching"
      })

      yield* handle.dispose()

      return yield* registry.list()
    })
  )

  expect(snapshot.entries).toEqual([])
})

test("observe emits the current snapshot", async () => {
  const snapshots = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({
        nextId: () => id("018e2f36-5800-7000-8000-000000000005")
      })
      yield* registry.register({
        kind: "runtime",
        ownerScope: "scope-runtime",
        state: "ready"
      })

      return yield* registry.observe().pipe(Stream.take(1), Stream.runCollect)
    })
  )

  expect(Array.from(snapshots)[0]?.entries.map((entry) => entry.handle.kind)).toEqual(["runtime"])
})

test("live layer provides the resource registry service", async () => {
  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* Effect.service(ResourceRegistry)

      return yield* registry.list()
    }).pipe(Effect.provide(ResourceRegistryLive))
  )

  expect(snapshot.entries).toEqual([])
})

test("uuidv7 embeds sortable millisecond time and version bits", () => {
  const uuid = generateUuidV7(1710000000000)

  expect(uuid.slice(0, 13)).toBe("018e23f1-4c00")
  expect(uuid.charAt(14)).toBe("7")
  expect(["8", "9", "a", "b"]).toContain(uuid.charAt(19))
})
