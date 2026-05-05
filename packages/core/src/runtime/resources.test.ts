import { expect, test } from "bun:test"
import { Effect, Fiber, Option, Schema, Stream } from "effect"

import {
  generateUuidV7,
  makeResourceRegistry,
  ResourceRegistry,
  ResourceRegistryLive,
  ResourceHandleShape,
  StaleHandle,
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

test("assertFresh returns StaleHandle after non-reusable disposal", async () => {
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({
        nextId: () => id("018e2f36-5800-7000-8000-000000000009")
      })
      const handle = yield* registry.register({
        kind: "process",
        ownerScope: "scope-process",
        state: "running"
      })

      yield* registry.dispose(handle.id)

      return yield* registry.assertFresh(handle).pipe(
        Effect.match({
          onFailure: (stale) => stale,
          onSuccess: () => {
            throw new Error("expected stale handle")
          }
        })
      )
    })
  )

  expect(error).toBeInstanceOf(StaleHandle)
  expect(error).toMatchObject({
    tag: "StaleHandle",
    kind: "process",
    id: "018e2f36-5800-7000-8000-000000000009",
    expectedGeneration: 0,
    actualGeneration: -1
  })
})

test("assertFresh accepts reusable id only at the current generation", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const reusedId = id("018e2f36-5800-7000-8000-000000000010")
      const first = yield* registry.register({
        kind: "stream",
        id: reusedId,
        ownerScope: "scope-stream",
        state: "open",
        reusableId: true
      })

      yield* registry.dispose(first.id)

      const second = yield* registry.register({
        kind: "stream",
        id: reusedId,
        ownerScope: "scope-stream",
        state: "open",
        reusableId: true
      })
      const fresh = yield* registry.assertFresh(second)
      const stale = yield* registry.assertFresh(first).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => {
            throw new Error("expected stale handle")
          }
        })
      )

      return { second, fresh, stale }
    })
  )

  expect(result.second.generation).toBe(1)
  expect(result.fresh.handle.generation).toBe(1)
  expect(result.stale).toMatchObject({
    tag: "StaleHandle",
    kind: "stream",
    id: "018e2f36-5800-7000-8000-000000000010",
    expectedGeneration: 0,
    actualGeneration: 1
  })
})

test("non-reusable explicit id reuse cannot refresh a disposed handle", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const reusedId = id("018e2f36-5800-7000-8000-000000000012")
      const first = yield* registry.register({
        kind: "process",
        id: reusedId,
        ownerScope: "scope-process",
        state: "running"
      })

      yield* registry.dispose(first.id)

      const second = yield* registry.register({
        kind: "process",
        id: reusedId,
        ownerScope: "scope-process",
        state: "running"
      })
      const stale = yield* registry.assertFresh(first).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => {
            throw new Error("expected stale handle")
          }
        })
      )

      return { second, stale }
    })
  )

  expect(result.second.generation).toBe(1)
  expect(result.stale).toMatchObject({
    tag: "StaleHandle",
    kind: "process",
    id: "018e2f36-5800-7000-8000-000000000012",
    expectedGeneration: 0,
    actualGeneration: -1
  })
})

test("register does not overwrite a live entry with a duplicate explicit id", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      let cleanupCount = 0
      const duplicateId = id("018e2f36-5800-7000-8000-000000000013")
      const fallbackId = id("018e2f36-5800-7000-8000-000000000014")
      const registry = yield* makeResourceRegistry({
        nextId: () => fallbackId
      })
      const first = yield* registry.register({
        kind: "process",
        id: duplicateId,
        ownerScope: "scope-process",
        state: "running",
        dispose: Effect.sync(() => {
          cleanupCount += 1
        })
      })
      const second = yield* registry.register({
        kind: "process",
        id: duplicateId,
        ownerScope: "scope-process",
        state: "running"
      })

      yield* registry.dispose(first.id)
      const snapshot = yield* registry.list()

      return { cleanupCount, first, second, snapshot }
    })
  )

  expect(result.first.id).toBe(id("018e2f36-5800-7000-8000-000000000013"))
  expect(result.second.id).toBe(id("018e2f36-5800-7000-8000-000000000014"))
  expect(result.cleanupCount).toBe(1)
  expect(result.snapshot.entries.map((entry) => entry.handle.id)).toEqual([result.second.id])
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

test("observe emits subsequent registry changes", async () => {
  const snapshots = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({
        nextId: () => id("018e2f36-5800-7000-8000-000000000006")
      })
      const fiber = yield* registry
        .observe()
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

      yield* registry.register({
        kind: "worker",
        ownerScope: "scope-worker",
        state: "ready"
      })

      return yield* Fiber.join(fiber)
    })
  )

  expect(Array.from(snapshots).map((snapshot) => snapshot.entries.length)).toEqual([0, 1])
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

test("resource handle schema matches the serializable handle shape", () => {
  const decodeHandle = Schema.decodeUnknownSync(ResourceHandleShape)

  expect(
    decodeHandle({
      kind: "process",
      id: "018e2f36-5800-7000-8000-000000000011",
      generation: 0,
      ownerScope: "scope-process",
      state: "running"
    })
  ).toMatchObject({
    kind: "process",
    id: "018e2f36-5800-7000-8000-000000000011",
    generation: 0,
    ownerScope: "scope-process",
    state: "running"
  })
})

test("uuidv7 embeds sortable millisecond time and version bits", () => {
  const uuid = generateUuidV7(1710000000000)

  expect(uuid.slice(0, 13)).toBe("018e23f1-4c00")
  expect(uuid.charAt(14)).toBe("7")
  expect(["8", "9", "a", "b"]).toContain(uuid.charAt(19))
})
