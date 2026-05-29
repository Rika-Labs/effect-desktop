import { expect, test } from "bun:test"
import { Context, Effect, Exit, Fiber, Layer, ManagedRuntime, Option, Stream } from "effect"
import { KeyValueStore } from "effect/unstable/persistence"

import {
  WindowDisplayBounds,
  WindowStateInvalidArgumentError,
  WindowStateReadFailed,
  WindowStateRecord,
  defaultWindowStatePath,
  makeWindowState
} from "./window-state.js"

const state = makeWindowStateRecord()
let nextPath = 0

test("WindowState persists and restores a validated window record", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const path = yield* tempWindowStatePath()
        const kv = yield* KeyValueStore.KeyValueStore
        const service = yield* makeWindowState("main", { path })

        yield* service.persist(state)
        const restored = yield* service.restore()

        expect(Option.getOrUndefined(restored)).toEqual(state)
        expect(yield* kv.get(path)).toContain('"main"')
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState persists through KeyValueStore without touching the filesystem", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const path = yield* tempWindowStatePath()
        const kv = yield* KeyValueStore.KeyValueStore
        const service = yield* makeWindowState("main", { path })

        yield* service.persist(state)

        expect(yield* kv.has(path)).toBe(true)
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState rejects empty window ids before reading durable state", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const path = yield* tempWindowStatePath()
        const kv = yield* KeyValueStore.KeyValueStore
        yield* kv.set(path, "{")

        const exit = yield* Effect.exit(makeWindowState("", { path, now: () => 1710000000000 }))

        expectInvalidArgument(exit, "WindowState.make")
        expect(yield* kv.get(path)).toBe("{")
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState rejects whitespace-only window ids", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const path = yield* tempWindowStatePath()

        const exit = yield* Effect.exit(makeWindowState("   ", { path }))

        expectInvalidArgument(exit, "WindowState.make")
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState rejects every C0 control byte and DEL in window ids", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const path = yield* tempWindowStatePath()
        const kv = yield* KeyValueStore.KeyValueStore

        for (let codePoint = 0; codePoint <= 31; codePoint += 1) {
          const windowId = `main${String.fromCharCode(codePoint)}forged`
          const exit = yield* Effect.exit(makeWindowState(windowId, { path }))
          expectInvalidArgument(exit, "WindowState.make")
        }
        const delId = `main${String.fromCharCode(127)}forged`
        const exit = yield* Effect.exit(makeWindowState(delId, { path }))
        expectInvalidArgument(exit, "WindowState.make")

        expect(yield* kv.has(path)).toBe(false)
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState default path rejects bundle ids with path traversal", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        for (const bundleId of [
          "",
          ".",
          "..",
          "../escape",
          "escape/child",
          "escape\\child",
          "/absolute",
          "C:escape",
          "com..example"
        ]) {
          const pathExit = yield* Effect.exit(defaultWindowStatePath(bundleId))
          expectInvalidBundleId(pathExit, "defaultWindowStatePath")
          const exit = yield* Effect.exit(makeWindowState("main", { bundleId }))
          expectInvalidBundleId(exit, "WindowState.make")
        }
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState default path accepts bundle ids as namespaces", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const path = yield* defaultWindowStatePath("com.example.effect-desktop")

      expect(path).toContain("com.example.effect-desktop")
      expect(path.endsWith("window-state.json")).toBe(true)
    })
  ))

test("WindowState clear removes the current window only", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const path = yield* tempWindowStatePath()
        const kv = yield* KeyValueStore.KeyValueStore
        const service = yield* makeWindowState("main", { path })
        const palette = yield* makeWindowState("palette", { path })

        yield* service.persist(state)
        yield* palette.persist(state)
        yield* service.clear()

        expect(yield* kv.get(path)).not.toContain('"main"')
        expect(yield* kv.get(path)).toContain('"palette"')
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState restore returns none for a missing window id", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const path = yield* tempWindowStatePath()
        const service = yield* makeWindowState("main", { path })

        const restored = yield* service.restore()

        expect(Option.isNone(restored)).toBe(true)
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState clears corrupt state and continues with defaults", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const path = yield* tempWindowStatePath()
        const kv = yield* KeyValueStore.KeyValueStore
        const service = yield* makeWindowState("main", { path, now: () => 1710000000000 })
        yield* kv.set(path, "{")

        const restored = yield* service.restore()

        expect(Option.isNone(restored)).toBe(true)
        expect(yield* kv.has(path)).toBe(false)
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState rejects invalid corrupt recovery timestamps without removing corrupt state", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const invalidTimestamps = [
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.NEGATIVE_INFINITY,
          -1
        ]

        for (const timestamp of invalidTimestamps) {
          const path = yield* tempWindowStatePath()
          const kv = yield* KeyValueStore.KeyValueStore
          const service = yield* makeWindowState("main", { path, now: () => timestamp })
          yield* kv.set(path, "{")

          const exit = yield* Effect.exit(service.restore())

          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
            expect(fail?.error).toBeInstanceOf(WindowStateReadFailed)
          }
          expect(yield* kv.get(path)).toBe("{")
        }
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState applies injected bounds validation on restore", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const path = yield* tempWindowStatePath()
        const service = yield* makeWindowState("main", {
          path,
          validateBounds: (record) =>
            makeWindowStateRecord({
              x: Math.max(0, record.x),
              y: Math.max(0, record.y)
            })
        })

        yield* service.persist(
          makeWindowStateRecord({
            x: -500,
            y: -400
          })
        )
        const restored = yield* service.restore()

        expect(Option.getOrThrow(restored).x).toBe(0)
        expect(Option.getOrThrow(restored).y).toBe(0)
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState scopes records by current window id", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const path = yield* tempWindowStatePath()
        const service = yield* makeWindowState("main", { path })
        const palette = yield* makeWindowState("palette", { path })

        yield* service.persist(makeWindowStateRecord({ x: 10 }))
        yield* palette.persist(makeWindowStateRecord({ x: 900 }))
        const restoredMain = yield* service.restore()
        const restoredPalette = yield* palette.restore()

        expect(Option.getOrThrow(restoredMain).x).toBe(10)
        expect(Option.getOrThrow(restoredPalette).x).toBe(900)
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState concurrent persists keep independent records", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const path = yield* tempWindowStatePath()
        const service = yield* makeWindowState("main", { path })
        const palette = yield* makeWindowState("palette", { path })

        yield* Effect.all(
          [
            service.persist(makeWindowStateRecord({ x: 10 })),
            palette.persist(makeWindowStateRecord({ x: 900 }))
          ],
          { concurrency: "unbounded" }
        )
        const restoredMain = yield* service.restore()
        const restoredPalette = yield* palette.restore()

        expect(Option.getOrThrow(restoredMain).x).toBe(10)
        expect(Option.getOrThrow(restoredPalette).x).toBe(900)
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState concurrent services sharing one path serialize read-modify-write", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const path = yield* tempWindowStatePath()
      const context = yield* Effect.scoped(Layer.build(KeyValueStore.layerMemory))
      const kv = Context.get(context, KeyValueStore.KeyValueStore)
      const slowKv: KeyValueStore.KeyValueStore = {
        ...kv,
        get: (key) =>
          kv.get(key).pipe(
            Effect.flatMap((value) => Effect.yieldNow.pipe(Effect.as(value))),
            Effect.flatMap((value) => Effect.yieldNow.pipe(Effect.as(value)))
          )
      }
      const slowLayer = Layer.succeed(KeyValueStore.KeyValueStore, slowKv)
      yield* runScoped(
        Effect.gen(function* () {
          const main = yield* makeWindowState("main", { path })
          const palette = yield* makeWindowState("palette", { path })

          yield* Effect.all(
            [
              main.persist(makeWindowStateRecord({ x: 10 })),
              palette.persist(makeWindowStateRecord({ x: 900 }))
            ],
            { concurrency: "unbounded" }
          )

          expect(Option.getOrThrow(yield* main.restore()).x).toBe(10)
          expect(Option.getOrThrow(yield* palette.restore()).x).toBe(900)
        }),
        slowLayer
      )
    })
  ))

test("WindowState restore corrupt recovery does not wipe a concurrent persist", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const path = yield* tempWindowStatePath()
      const context = yield* Effect.scoped(Layer.build(KeyValueStore.layerMemory))
      const kv = Context.get(context, KeyValueStore.KeyValueStore)
      let getCount = 0
      const slowKv: KeyValueStore.KeyValueStore = {
        ...kv,
        get: (key) => {
          getCount += 1
          const slow = getCount === 1
          return kv
            .get(key)
            .pipe(
              Effect.flatMap((value) =>
                slow
                  ? Effect.yieldNow.pipe(Effect.andThen(Effect.yieldNow), Effect.as(value))
                  : Effect.succeed(value)
              )
            )
        },
        remove: (key) =>
          Effect.yieldNow.pipe(Effect.andThen(Effect.yieldNow), Effect.andThen(kv.remove(key)))
      }
      const slowLayer = Layer.succeed(KeyValueStore.KeyValueStore, slowKv)
      yield* runScoped(
        Effect.gen(function* () {
          const main = yield* makeWindowState("main", { path, now: () => 1710000000000 })
          const palette = yield* makeWindowState("palette", { path, now: () => 1710000000000 })

          yield* kv.set(path, "{")
          getCount = 0

          yield* Effect.all([main.restore(), palette.persist(makeWindowStateRecord({ x: 900 }))], {
            concurrency: "unbounded"
          })

          const restoredPalette = yield* palette.restore()
          expect(Option.isSome(restoredPalette)).toBe(true)
          expect(Option.getOrThrow(restoredPalette).x).toBe(900)
        }),
        slowLayer
      )
    })
  ))

test("WindowState snaps off-screen windows to the primary display", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const path = yield* tempWindowStatePath()
        const service = yield* makeWindowState("main", {
          path,
          displays: [
            new WindowDisplayBounds({ x: 0, y: 0, width: 1024, height: 768, primary: true }),
            new WindowDisplayBounds({ x: 1024, y: 0, width: 1024, height: 768 })
          ]
        })

        yield* service.persist(makeWindowStateRecord({ x: 5000, y: 5000 }))
        const restored = yield* service.restore()

        expect(Option.getOrThrow(restored).x).toBe(0)
        expect(Option.getOrThrow(restored).y).toBe(0)
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState snaps stale display records to the current primary display", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const path = yield* tempWindowStatePath()
        const service = yield* makeWindowState("main", {
          path,
          displays: [
            new WindowDisplayBounds({
              id: "primary",
              x: 0,
              y: 0,
              width: 1024,
              height: 768,
              scaleFactor: 2,
              primary: true
            }),
            new WindowDisplayBounds({
              id: "secondary",
              x: 1024,
              y: 0,
              width: 1024,
              height: 768,
              scaleFactor: 1
            })
          ]
        })

        yield* service.persist(makeWindowStateRecord({ x: 1200, y: 40, displayId: "removed" }))
        const restored = yield* service.restore()

        expect(Option.getOrThrow(restored)).toMatchObject({
          x: 0,
          y: 0,
          displayId: "primary",
          scaleFactor: 2
        })
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState keeps records visible on their saved display", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const path = yield* tempWindowStatePath()
        const service = yield* makeWindowState("main", {
          path,
          displays: [
            new WindowDisplayBounds({
              id: "primary",
              x: 0,
              y: 0,
              width: 1024,
              height: 768,
              primary: true
            }),
            new WindowDisplayBounds({ id: "secondary", x: 1024, y: 0, width: 1024, height: 768 })
          ]
        })

        yield* service.persist(makeWindowStateRecord({ x: 1200, y: 40, displayId: "secondary" }))
        const restored = yield* service.restore()

        expect(Option.getOrThrow(restored)).toMatchObject({
          x: 1200,
          y: 40,
          displayId: "secondary"
        })
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState clear leaves other window records intact", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const path = yield* tempWindowStatePath()
        const service = yield* makeWindowState("main", { path })
        const palette = yield* makeWindowState("palette", { path })

        yield* service.persist(makeWindowStateRecord({ x: 10 }))
        yield* palette.persist(makeWindowStateRecord({ x: 900 }))
        yield* service.clear()
        expect(Option.isNone(yield* service.restore())).toBe(true)

        const restoredPalette = yield* palette.restore()
        expect(Option.getOrThrow(restoredPalette).x).toBe(900)
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState observe emits persist, clear, and corrupt recovery events", () =>
  Effect.runPromise(
    runScoped(
      Effect.gen(function* () {
        const path = yield* tempWindowStatePath()
        const kv = yield* KeyValueStore.KeyValueStore
        const service = yield* makeWindowState("main", { path, now: () => 1710000000000 })
        const fiber = yield* Effect.forkChild(
          service.observe().pipe(Stream.take(3), Stream.runCollect),
          { startImmediately: true }
        )

        yield* service.persist(state)
        yield* service.clear()
        yield* kv.set(path, "{")
        yield* service.restore()
        const events = Array.from(yield* Fiber.join(fiber))

        expect(events.map((event) => event.kind)).toEqual([
          "persisted",
          "cleared",
          "corrupt-renamed"
        ])
        expect(events[0]?.windowId).toBe("main")
        expect(events[1]?.windowId).toBe("main")
        expect(events[2]?.corruptPath).toContain("window-state.corrupt.1710000000000.json")
      }),
      KeyValueStore.layerMemory
    )
  ))

test("WindowState rejects non-finite scroll positions", () => {
  expect(() => makeWindowStateRecord({ scrollPositions: { feed: Number.NaN } })).toThrow()
  expect(() =>
    makeWindowStateRecord({ scrollPositions: { feed: Number.POSITIVE_INFINITY } })
  ).toThrow()
  expect(() =>
    makeWindowStateRecord({ scrollPositions: { feed: Number.NEGATIVE_INFINITY } })
  ).toThrow()
  expect(() => makeWindowStateRecord({ scrollPositions: { feed: 42 } })).not.toThrow()
})

const tempWindowStatePath = (): Effect.Effect<string> =>
  Effect.sync(() => {
    nextPath += 1
    return `window-state-${String(nextPath)}.json`
  })

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

function expectInvalidArgument(exit: Exit.Exit<unknown, unknown>, expectedOperation: string): void {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
    expect(fail?.error).toBeInstanceOf(WindowStateInvalidArgumentError)
    const error = fail?.error as WindowStateInvalidArgumentError
    expect(error.operation).toBe(expectedOperation)
    expect(error.field).toBe("windowId")
  }
}

function expectInvalidBundleId(exit: Exit.Exit<unknown, unknown>, expectedOperation: string): void {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
    expect(fail?.error).toBeInstanceOf(WindowStateInvalidArgumentError)
    const error = fail?.error as WindowStateInvalidArgumentError
    expect(error.operation).toBe(expectedOperation)
    expect(error.field).toBe("bundleId")
  }
}

function makeWindowStateRecord(overrides: Partial<WindowStateRecord> = {}): WindowStateRecord {
  return new WindowStateRecord({
    x: overrides.x ?? 100,
    y: overrides.y ?? 120,
    width: overrides.width ?? 800,
    height: overrides.height ?? 600,
    ...(overrides.displayId === undefined ? {} : { displayId: overrides.displayId }),
    isFullScreen: overrides.isFullScreen ?? false,
    scaleFactor: overrides.scaleFactor ?? 2,
    zoom: overrides.zoom ?? 1,
    ...(overrides.devtoolsPanel === undefined ? {} : { devtoolsPanel: overrides.devtoolsPanel }),
    ...(overrides.scrollPositions === undefined
      ? {}
      : { scrollPositions: overrides.scrollPositions })
  })
}
