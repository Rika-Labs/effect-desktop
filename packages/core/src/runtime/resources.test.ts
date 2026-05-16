import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Schema, Stream } from "effect"

import {
  generateUuidV7,
  makeResourceId,
  makeResourceRegistry,
  ResourceInvalidArgumentError,
  ResourceRegistry,
  ResourceRegistryLive,
  ResourceHandleShape,
  ResourceHandleSchema,
  StaleHandle
} from "./resources.js"

const id = makeResourceId

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
  expect(result.snapshot.entries.map((entry) => entry.handle.id)).toEqual([
    result.snapshot.entries[0]!.handle.id
  ])
  expect(result.snapshot.entries[0]?.createdAt).toBe(1710000000000)
})

test("register rejects invalid registry timestamps before allocating ids", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({
        now: () => Number.NaN,
        nextId: () => id("018e2f36-5800-7000-8000-0000000000ff")
      })

      yield* registry.register({
        kind: "window",
        ownerScope: "scope-test",
        state: "open"
      })
    })
  )

  expectFailure(exit, ResourceInvalidArgumentError)
})

test("register rejects empty resource identity fields before allocating ids", async () => {
  for (const input of [
    { kind: "", ownerScope: "scope-test", state: "open" },
    { kind: "window", ownerScope: "   ", state: "open" },
    { kind: "window", ownerScope: "scope-test", state: "" }
  ]) {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* makeResourceRegistry({
          nextId: () => id("018e2f36-5800-7000-8000-0000000000aa")
        })
        const exit = yield* Effect.exit(registry.register(input))
        const snapshot = yield* registry.list()

        return { exit, snapshot }
      })
    )

    expectFailure(result.exit, ResourceInvalidArgumentError)
    expect(result.snapshot.entries).toEqual([])
  }
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

test("public registry reads return serializable handles without dispose", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({
        nextId: () => id("018e2f36-5800-7000-8000-0000000000ab")
      })
      const managed = yield* registry.register({
        kind: "window",
        ownerScope: "scope-window",
        state: "open"
      })
      const listed = yield* registry.list()
      const got = yield* registry.get(managed.id)
      const fresh = yield* registry.assertFresh(managed)
      const observed = yield* registry.observe().pipe(Stream.take(1), Stream.runCollect)

      return {
        managed,
        listed: listed.entries[0]?.handle,
        got: Option.isSome(got) ? got.value.handle : undefined,
        fresh: fresh.handle,
        observed: Array.from(observed)[0]?.entries[0]?.handle
      }
    })
  )

  expect("dispose" in result.managed).toBe(true)
  for (const handle of [result.listed, result.got, result.fresh, result.observed]) {
    expect(handle).toMatchObject({
      kind: "window",
      id: id("018e2f36-5800-7000-8000-0000000000ab"),
      generation: 0,
      ownerScope: "scope-window",
      state: "open"
    })
    expect("dispose" in handle!).toBe(false)
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

test("dispose removes the resource when cleanup defects", async () => {
  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({
        nextId: () => id("018e2f36-5800-7000-8000-0000000000b1")
      })
      const handle = yield* registry.register({
        kind: "stream",
        ownerScope: "scope-stream",
        state: "open",
        dispose: Effect.sync(() => {
          throw new Error("stream disposer failed")
        })
      })

      yield* registry.dispose(handle.id)

      return yield* registry.list()
    })
  )

  expect(snapshot.entries).toEqual([])
})

test("dispose keeps resources in the registry while cleanup is in progress", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void, never>()
      const resume = yield* Deferred.make<void, never>()
      const registry = yield* makeResourceRegistry({
        now: () => 1710000000001,
        nextId: () => id("018e2f36-5800-7000-8000-000000000008")
      })
      const handle = yield* registry.register({
        kind: "stream",
        ownerScope: "scope-stream",
        state: "open",
        dispose: Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(resume)
        })
      })
      const disposal = yield* registry.dispose(handle.id).pipe(Effect.forkChild())

      yield* Deferred.await(started)
      const snapshot = yield* registry.list()
      const stale = yield* registry.assertFresh(handle).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => {
            throw new Error("expected disposing handle to be stale")
          }
        })
      )
      const shareStale = yield* registry.share(handle, "target-scope").pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => {
            throw new Error("expected disposing handle share to be stale")
          }
        })
      )
      yield* Deferred.succeed(resume, undefined)
      yield* Fiber.join(disposal)
      const final = yield* registry.list()

      return { snapshot, stale, shareStale, final }
    })
  )

  expect(result.snapshot.entries.map((entry) => entry.handle.id)).toEqual([
    id("018e2f36-5800-7000-8000-000000000008")
  ])
  expect(result.stale).toBeInstanceOf(StaleHandle)
  expect(result.stale).toMatchObject({
    tag: "StaleHandle",
    kind: "stream",
    id: "018e2f36-5800-7000-8000-000000000008"
  })
  expect(result.shareStale).toBeInstanceOf(StaleHandle)
  expect(result.final.entries).toEqual([])
})

test("duplicate dispose waits for in-flight cleanup to remove the entry", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void, never>()
      const resume = yield* Deferred.make<void, never>()
      const registry = yield* makeResourceRegistry({
        nextId: () => id("018e2f36-5800-7000-8000-0000000000ad")
      })
      const handle = yield* registry.register({
        kind: "stream",
        ownerScope: "scope-stream",
        state: "open",
        dispose: Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(resume)
        })
      })

      const first = yield* registry.dispose(handle.id).pipe(Effect.forkChild())
      yield* Deferred.await(started)
      const secondDone = yield* Deferred.make<void, never>()
      const second = yield* registry
        .dispose(handle.id)
        .pipe(Effect.andThen(Deferred.succeed(secondDone, undefined)), Effect.forkChild())
      const secondBeforeRemoval = yield* Deferred.await(secondDone).pipe(
        Effect.timeoutOption("5 millis")
      )

      yield* Deferred.succeed(resume, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      const final = yield* registry.list()

      return { final, secondBeforeRemoval }
    })
  )

  expect(Option.isNone(result.secondBeforeRemoval)).toBe(true)
  expect(result.final.entries).toEqual([])
})

test("interrupted dispose still clears the disposing entry", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void, never>()
      const resume = yield* Deferred.make<void, never>()
      const registry = yield* makeResourceRegistry({
        nextId: () => id("018e2f36-5800-7000-8000-0000000000af")
      })
      const handle = yield* registry.register({
        kind: "stream",
        ownerScope: "scope-stream",
        state: "open",
        dispose: Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(resume)
        })
      })

      const first = yield* registry.dispose(handle.id).pipe(Effect.forkChild())
      yield* Deferred.await(started)
      const interrupted = yield* Fiber.interrupt(first).pipe(Effect.forkChild())
      const secondDone = yield* Deferred.make<void, never>()
      const second = yield* registry
        .dispose(handle.id)
        .pipe(Effect.andThen(Deferred.succeed(secondDone, undefined)), Effect.forkChild())
      const secondBeforeResume = yield* Deferred.await(secondDone).pipe(
        Effect.timeoutOption("5 millis")
      )

      yield* Deferred.succeed(resume, undefined)
      yield* Fiber.join(interrupted)
      yield* Fiber.join(second)
      const final = yield* registry.list()

      return { final, secondBeforeResume }
    })
  )

  expect(Option.isNone(result.secondBeforeResume)).toBe(true)
  expect(result.final.entries).toEqual([])
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

test("assertFresh and share reject handles with mismatched state", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({
        nextId: () => id("018e2f36-5800-7000-8000-0000000000ac")
      })
      const handle = yield* registry.register({
        kind: "process",
        ownerScope: "scope-process",
        state: "running"
      })
      const forged = {
        kind: handle.kind,
        id: handle.id,
        generation: handle.generation,
        ownerScope: handle.ownerScope,
        state: "stopped"
      } as const
      const freshExit = yield* Effect.exit(registry.assertFresh(forged))
      const shareExit = yield* Effect.exit(registry.share(forged, "target-scope"))
      const snapshot = yield* registry.list()

      return { freshExit, shareExit, snapshot }
    })
  )

  expectFailure(result.freshExit, StaleHandle)
  expectFailure(result.shareExit, StaleHandle)
  expect(result.snapshot.entries.map((entry) => entry.handle)).toEqual([
    {
      kind: "process",
      id: id("018e2f36-5800-7000-8000-0000000000ac"),
      generation: 0,
      ownerScope: "scope-process",
      state: "running"
    }
  ])
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

test("register retries generated ids until the id is live-unique", async () => {
  const originalGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)

  try {
    stubCryptoRandomValuesWithZeroes()
    const now = 1710000000000
    const collidingFallbackId = generateUuidV7(now)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* makeResourceRegistry({
          now: () => now,
          nextId: () => collidingFallbackId
        })
        const first = yield* registry.register({
          kind: "process",
          id: collidingFallbackId,
          ownerScope: "scope-process",
          state: "running"
        })
        const second = yield* registry.register({
          kind: "worker",
          ownerScope: "scope-worker",
          state: "ready"
        })
        const snapshot = yield* registry.list()
        return { first, second, snapshot }
      })
    )

    expect(result.first.id).toBe(collidingFallbackId)
    expect(result.second.id).not.toBe(collidingFallbackId)
    expect(result.snapshot.entries.map((entry) => entry.handle.id).sort()).toEqual(
      [result.first.id, result.second.id].sort()
    )
  } finally {
    globalThis.crypto.getRandomValues = originalGetRandomValues
  }
})

test("closeScope disposes transitively owned resources child scopes first", async () => {
  const disposalOrder = await Effect.runPromise(
    Effect.gen(function* () {
      const order: string[] = []
      const registry = yield* makeResourceRegistry()
      yield* registry.declareScope("process-scope", "window-scope")
      yield* registry.declareScope("stream-scope", "process-scope")
      yield* registry.register({
        kind: "window",
        id: id("018e2f36-5800-7000-8000-000000000015"),
        ownerScope: "window-scope",
        state: "open",
        dispose: Effect.sync(() => {
          order.push("window")
        })
      })
      yield* registry.register({
        kind: "process",
        id: id("018e2f36-5800-7000-8000-000000000016"),
        ownerScope: "process-scope",
        state: "running",
        dispose: Effect.sync(() => {
          order.push("process")
        })
      })
      yield* registry.register({
        kind: "stream",
        id: id("018e2f36-5800-7000-8000-000000000017"),
        ownerScope: "stream-scope",
        state: "open",
        dispose: Effect.sync(() => {
          order.push("stream")
        })
      })

      yield* registry.closeScope("window-scope")
      const snapshot = yield* registry.list()

      return { order, snapshot }
    })
  )

  expect(disposalOrder.order).toEqual(["stream", "process", "window"])
  expect(disposalOrder.snapshot.entries).toEqual([])
})

test("closeScope continues to close all scope resources when one disposer fails", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const order: string[] = []
      let now = 1710000000000
      const registry = yield* makeResourceRegistry({
        now: () => {
          now += 1
          return now
        }
      })
      yield* registry.register({
        kind: "process",
        id: id("018e2f36-5800-7000-8000-000000000100"),
        ownerScope: "scope-failure",
        state: "running",
        dispose: Effect.sync(() => {
          order.push("process")
          throw new Error("process disposer failed")
        })
      })
      yield* registry.register({
        kind: "worker",
        id: id("018e2f36-5800-7000-8000-000000000101"),
        ownerScope: "scope-failure",
        state: "running",
        dispose: Effect.sync(() => {
          order.push("worker")
        })
      })
      yield* registry.closeScope("scope-failure")
      const snapshot = yield* registry.list()

      return { order, snapshot }
    })
  )

  expect(result.order).toEqual(["worker", "process"])
  expect(result.snapshot.entries).toEqual([])
})

test("share returns a fresh target-scope handle without closing with the source scope", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      let cleanupCount = 0
      const registry = yield* makeResourceRegistry({
        nextId: () => id("018e2f36-5800-7000-8000-000000000019")
      })
      const original = yield* registry.register({
        kind: "window",
        id: id("018e2f36-5800-7000-8000-000000000018"),
        ownerScope: "source-scope",
        state: "open",
        dispose: Effect.sync(() => {
          cleanupCount += 1
        })
      })
      const shared = yield* registry.share(original, "target-scope")

      yield* registry.closeScope("source-scope")
      const sourceClosedSnapshot = yield* registry.list()
      const cleanupAfterSourceClose = cleanupCount
      yield* registry.closeScope("target-scope")
      const targetClosedSnapshot = yield* registry.list()

      return {
        cleanupAfterSourceClose,
        cleanupCount,
        shared,
        sourceClosedSnapshot,
        targetClosedSnapshot
      }
    })
  )

  expect(result.cleanupAfterSourceClose).toBe(0)
  expect(result.cleanupCount).toBe(1)
  expect(result.shared.ownerScope).toBe("target-scope")
  expect(result.sourceClosedSnapshot.entries.map((entry) => entry.handle.id)).toEqual([
    result.shared.id
  ])
  expect(result.targetClosedSnapshot.entries).toEqual([])
})

test("closeScope removes a resource when its disposer exceeds disposalGraceMs", async () => {
  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      yield* registry.register({
        kind: "stream",
        id: id("018e2f36-5800-7000-8000-000000000020"),
        ownerScope: "scope-timeout",
        state: "open",
        disposalGraceMs: 5,
        dispose: Effect.never
      })

      yield* registry.closeScope("scope-timeout")

      return yield* registry.list()
    })
  )

  expect(snapshot.entries).toEqual([])
})

test("closeScope handles cyclic scope declarations without hanging", async () => {
  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      yield* registry.declareScope("scope-a", "scope-b")
      yield* registry.declareScope("scope-b", "scope-a")
      yield* registry.register({
        kind: "worker",
        id: id("018e2f36-5800-7000-8000-000000000021"),
        ownerScope: "scope-b",
        state: "ready"
      })

      yield* registry.closeScope("scope-a")

      return yield* registry.list()
    }).pipe(Effect.timeout("100 millis"))
  )

  expect(snapshot.entries).toEqual([])
})

test("declareScope rejects blank scope declarations before mutating parents", async () => {
  for (const input of [
    { scope: "", parent: "parent-scope" },
    { scope: "   ", parent: "parent-scope" },
    { scope: "child-scope", parent: "" }
  ]) {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* makeResourceRegistry()
        const exit = yield* Effect.exit(registry.declareScope(input.scope, input.parent))
        yield* registry.register({
          kind: "worker",
          id: id("018e2f36-5800-7000-8000-000000000022"),
          ownerScope: "child-scope",
          state: "ready"
        })
        yield* registry.closeScope("parent-scope")
        const snapshot = yield* registry.list()

        return { exit, snapshot }
      })
    )

    expectFailure(result.exit, ResourceInvalidArgumentError)
    expect(result.snapshot.entries.map((entry) => entry.handle.ownerScope)).toEqual(["child-scope"])
  }
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

test("observeLifecycle streams resource, scope, and stale-handle events", async () => {
  const events = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({
        nextId: () => id("018e2f36-5800-7000-8000-0000000000af")
      })
      const fiber = yield* registry
        .observeLifecycle()
        .pipe(Stream.take(7), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

      yield* registry.declareScope("scope-parent")
      yield* registry.declareScope("scope-child", "scope-parent")
      const handle = yield* registry.register({
        kind: "window",
        ownerScope: "scope-child",
        state: "open"
      })
      yield* registry.closeScope("scope-parent")
      yield* Effect.exit(registry.assertFresh(handle))

      return yield* Fiber.join(fiber)
    })
  )

  expect(Array.from(events).map((event) => event._tag)).toEqual([
    "ScopeDeclared",
    "ScopeDeclared",
    "ResourceRegistered",
    "ScopeClosing",
    "ResourceDisposed",
    "ScopeClosed",
    "ResourceStale"
  ])
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

test("live layer finalization closes leaked registered resources", async () => {
  let cleanupCount = 0

  const snapshot = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* Effect.service(ResourceRegistry)
        yield* registry.register({
          kind: "runtime",
          id: id("018e2f36-5800-7000-8000-0000000000ae"),
          ownerScope: "scope-runtime",
          state: "ready",
          dispose: Effect.sync(() => {
            cleanupCount += 1
          })
        })

        return yield* registry.list()
      }).pipe(Effect.provide(ResourceRegistryLive))
    )
  )

  expect(snapshot.entries.map((entry) => entry.handle.id)).toEqual([
    id("018e2f36-5800-7000-8000-0000000000ae")
  ])
  expect(cleanupCount).toBe(1)
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

test("resource handle schema narrows kind and state", () => {
  const decodeHandle = Schema.decodeUnknownSync(ResourceHandleSchema("process", "running"))

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

  expect(() =>
    decodeHandle({
      kind: "worker",
      id: "018e2f36-5800-7000-8000-000000000011",
      generation: 0,
      ownerScope: "scope-process",
      state: "running"
    })
  ).toThrow()

  expect(() =>
    decodeHandle({
      kind: "process",
      id: "",
      generation: 0,
      ownerScope: "scope-process",
      state: "running"
    })
  ).toThrow()

  expect(() =>
    decodeHandle({
      kind: "process",
      id: "018e2f36-5800-7000-8000-000000000011",
      generation: -1,
      ownerScope: "scope-process",
      state: "running"
    })
  ).toThrow()

  expect(() =>
    decodeHandle({
      kind: "process",
      id: "018e2f36-5800-7000-8000-000000000011",
      generation: 0,
      ownerScope: "scope-process",
      state: "open"
    })
  ).toThrow()
})

test("uuidv7 embeds sortable millisecond time and version bits", () => {
  const uuid = generateUuidV7(1710000000000)

  expect(uuid.slice(0, 13)).toBe("018e23f1-4c00")
  expect(uuid.charAt(14)).toBe("7")
  expect(["8", "9", "a", "b"]).toContain(uuid.charAt(19))
})

function expectFailure<E>(
  exit: Exit.Exit<unknown, E>,
  errorClass: abstract new (...args: never[]) => E
): void {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(errorClass)
  }
}

const stubCryptoRandomValuesWithZeroes = (): void => {
  globalThis.crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
    if (array instanceof Uint8Array) {
      array.fill(0)
    }
    return array
  }) as Crypto["getRandomValues"]
}
