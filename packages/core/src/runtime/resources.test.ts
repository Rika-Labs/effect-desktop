import { expect, test } from "bun:test"
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Schema,
  Stream
} from "effect"

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

test("register returns handles and list enumerates live resources", () =>
  Effect.runPromise(
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

      expect(handle).toMatchObject({
        kind: "process",
        id: "018e2f36-5800-7000-8000-000000000001",
        generation: 0,
        ownerScope: "scope-test",
        state: "running"
      })
      expect(snapshot.entries.map((entry) => entry.handle.id)).toEqual([
        snapshot.entries[0]!.handle.id
      ])
      expect(snapshot.entries[0]?.createdAt).toBe(1710000000000)
    })
  ))

test("register rejects invalid registry timestamps before allocating ids", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
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
  ))

test("register rejects empty resource identity fields before allocating ids", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const input of [
        { kind: "", ownerScope: "scope-test", state: "open" },
        { kind: "window", ownerScope: "   ", state: "open" },
        { kind: "window", ownerScope: "scope-test", state: "" }
      ]) {
        const registry = yield* makeResourceRegistry({
          nextId: () => id("018e2f36-5800-7000-8000-0000000000aa")
        })
        const exit = yield* Effect.exit(registry.register(input))
        const snapshot = yield* registry.list()

        expectFailure(exit, ResourceInvalidArgumentError)
        expect(snapshot.entries).toEqual([])
      }
    })
  ))

test("get returns the matching live resource", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({
        nextId: () => id("018e2f36-5800-7000-8000-000000000002")
      })
      const handle = yield* registry.register({
        kind: "window",
        ownerScope: "scope-window",
        state: "open"
      })
      const result = yield* registry.get(handle.id)

      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.handle.kind).toBe("window")
      }
    })
  ))

test("public registry reads return serializable handles without dispose", () =>
  Effect.runPromise(
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

      const handles = [
        listed.entries[0]?.handle,
        Option.isSome(got) ? got.value.handle : undefined,
        fresh.handle,
        Array.from(observed)[0]?.entries[0]?.handle
      ]

      expect("dispose" in managed).toBe(true)
      for (const handle of handles) {
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
  ))

test("dispose runs cleanup once and removes the resource", () =>
  Effect.runPromise(
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

      expect(cleanupCount).toBe(1)
      expect(snapshot.entries).toEqual([])
    })
  ))

test("dispose removes the resource when cleanup defects", () =>
  Effect.runPromise(
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
      const snapshot = yield* registry.list()

      expect(snapshot.entries).toEqual([])
    })
  ))

test("dispose keeps resources in the registry while cleanup is in progress", () =>
  Effect.runPromise(
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

      expect(snapshot.entries.map((entry) => entry.handle.id)).toEqual([
        id("018e2f36-5800-7000-8000-000000000008")
      ])
      expect(stale).toBeInstanceOf(StaleHandle)
      expect(stale).toMatchObject({
        tag: "StaleHandle",
        kind: "stream",
        id: "018e2f36-5800-7000-8000-000000000008"
      })
      expect(shareStale).toBeInstanceOf(StaleHandle)
      expect(final.entries).toEqual([])
    })
  ))

test("duplicate dispose waits for in-flight cleanup to remove the entry", () =>
  Effect.runPromise(
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

      expect(Option.isNone(secondBeforeRemoval)).toBe(true)
      expect(final.entries).toEqual([])
    })
  ))

test("interrupted dispose still clears the disposing entry", () =>
  Effect.runPromise(
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

      expect(Option.isNone(secondBeforeResume)).toBe(true)
      expect(final.entries).toEqual([])
    })
  ))

test("assertFresh returns StaleHandle after non-reusable disposal", () =>
  Effect.runPromise(
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

      const error = yield* registry.assertFresh(handle).pipe(
        Effect.match({
          onFailure: (stale) => stale,
          onSuccess: () => {
            throw new Error("expected stale handle")
          }
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
  ))

test("assertFresh accepts reusable id only at the current generation", () =>
  Effect.runPromise(
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

      expect(second.generation).toBe(1)
      expect(fresh.handle.generation).toBe(1)
      expect(stale).toMatchObject({
        tag: "StaleHandle",
        kind: "stream",
        id: "018e2f36-5800-7000-8000-000000000010",
        expectedGeneration: 0,
        actualGeneration: 1
      })
    })
  ))

test("assertFresh and share reject handles with mismatched state", () =>
  Effect.runPromise(
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

      expectFailure(freshExit, StaleHandle)
      expectFailure(shareExit, StaleHandle)
      expect(snapshot.entries.map((entry) => entry.handle)).toEqual([
        {
          kind: "process",
          id: id("018e2f36-5800-7000-8000-0000000000ac"),
          generation: 0,
          ownerScope: "scope-process",
          state: "running"
        }
      ])
    })
  ))

test("non-reusable explicit id reuse cannot refresh a disposed handle", () =>
  Effect.runPromise(
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

      expect(second.generation).toBe(1)
      expect(stale).toMatchObject({
        tag: "StaleHandle",
        kind: "process",
        id: "018e2f36-5800-7000-8000-000000000012",
        expectedGeneration: 0,
        actualGeneration: -1
      })
    })
  ))

test("register does not overwrite a live entry with a duplicate explicit id", () =>
  Effect.runPromise(
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

      expect(first.id).toBe(id("018e2f36-5800-7000-8000-000000000013"))
      expect(second.id).toBe(id("018e2f36-5800-7000-8000-000000000014"))
      expect(cleanupCount).toBe(1)
      expect(snapshot.entries.map((entry) => entry.handle.id)).toEqual([second.id])
    })
  ))

test("register retries generated ids until the id is live-unique", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const originalGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
      const restore = Effect.sync(() => {
        globalThis.crypto.getRandomValues = originalGetRandomValues
      })

      const program = Effect.gen(function* () {
        stubCryptoRandomValuesWithZeroes()
        const now = 1710000000000
        const collidingFallbackId = generateUuidV7(now)
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

        expect(first.id).toBe(collidingFallbackId)
        expect(second.id).not.toBe(collidingFallbackId)
        expect(snapshot.entries.map((entry) => entry.handle.id).sort()).toEqual(
          [first.id, second.id].sort()
        )
      })

      yield* program.pipe(Effect.ensuring(restore))
    })
  ))

test("closeScope disposes transitively owned resources child scopes first", () =>
  Effect.runPromise(
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

      expect(order).toEqual(["stream", "process", "window"])
      expect(snapshot.entries).toEqual([])
    })
  ))

test("closeScope continues to close all scope resources when one disposer fails", () =>
  Effect.runPromise(
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

      expect(order).toEqual(["worker", "process"])
      expect(snapshot.entries).toEqual([])
    })
  ))

test("share returns a fresh target-scope handle without closing with the source scope", () =>
  Effect.runPromise(
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

      expect(cleanupAfterSourceClose).toBe(0)
      expect(cleanupCount).toBe(1)
      expect(shared.ownerScope).toBe("target-scope")
      expect(sourceClosedSnapshot.entries.map((entry) => entry.handle.id)).toEqual([shared.id])
      expect(targetClosedSnapshot.entries).toEqual([])
    })
  ))

test("closeScope removes a resource when its disposer exceeds disposalGraceMs", () =>
  Effect.runPromise(
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
      const snapshot = yield* registry.list()

      expect(snapshot.entries).toEqual([])
    })
  ))

test("closeScope handles cyclic scope declarations without hanging", () =>
  Effect.runPromise(
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
      const snapshot = yield* registry.list()

      expect(snapshot.entries).toEqual([])
    }).pipe(Effect.timeout("100 millis"))
  ))

test("declareScope rejects blank scope declarations before mutating parents", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const input of [
        { scope: "", parent: "parent-scope" },
        { scope: "   ", parent: "parent-scope" },
        { scope: "child-scope", parent: "" }
      ]) {
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

        expectFailure(exit, ResourceInvalidArgumentError)
        expect(snapshot.entries.map((entry) => entry.handle.ownerScope)).toEqual(["child-scope"])
      }
    })
  ))

test("handle dispose delegates to the registry", () =>
  Effect.runPromise(
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
      const snapshot = yield* registry.list()

      expect(snapshot.entries).toEqual([])
    })
  ))

test("observe emits the current snapshot", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry({
        nextId: () => id("018e2f36-5800-7000-8000-000000000005")
      })
      yield* registry.register({
        kind: "runtime",
        ownerScope: "scope-runtime",
        state: "ready"
      })

      const snapshots = yield* registry.observe().pipe(Stream.take(1), Stream.runCollect)

      expect(Array.from(snapshots)[0]?.entries.map((entry) => entry.handle.kind)).toEqual([
        "runtime"
      ])
    })
  ))

test("observe emits subsequent registry changes", () =>
  Effect.runPromise(
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

      const snapshots = yield* Fiber.join(fiber)

      expect(Array.from(snapshots).map((snapshot) => snapshot.entries.length)).toEqual([0, 1])
    })
  ))

test("observeLifecycle streams resource, scope, and stale-handle events", () =>
  Effect.runPromise(
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

      const events = yield* Fiber.join(fiber)

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
  ))

test("live layer provides the resource registry service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const snapshot = yield* runScoped(
        Effect.gen(function* () {
          const registry = yield* Effect.service(ResourceRegistry)
          return yield* registry.list()
        }),
        ResourceRegistryLive
      )

      expect(snapshot.entries).toEqual([])
    })
  ))

test("live layer finalization closes leaked registered resources", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let cleanupCount = 0

      const snapshot = yield* runScoped(
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
        }),
        ResourceRegistryLive
      )

      expect(snapshot.entries.map((entry) => entry.handle.id)).toEqual([
        id("018e2f36-5800-7000-8000-0000000000ae")
      ])
      expect(cleanupCount).toBe(1)
    })
  ))

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

const runScoped = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<A, E | LE, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const exit = yield* Effect.promise(() => runtime.runPromiseExit(effect))
    yield* Effect.promise(() => runtime.dispose())
    return yield* exit
  })
