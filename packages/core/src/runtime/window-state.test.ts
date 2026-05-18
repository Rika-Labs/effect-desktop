import { expect, test } from "bun:test"
import { Context, Effect, Exit, Fiber, Layer, Option, Stream } from "effect"
import { KeyValueStore } from "effect/unstable/persistence"

import {
  WindowDisplayBounds,
  WindowStateInvalidArgumentError,
  WindowStateReadFailed,
  WindowStateRecord,
  type WindowStateApi,
  defaultWindowStatePath,
  makeWindowState
} from "./window-state.js"

const state = makeWindowStateRecord()
let nextPath = 0

test("WindowState persists and restores a validated window record", async () => {
  const path = await tempWindowStatePath()
  const { kv, service } = await makeFixture({ path })

  await Effect.runPromise(service.persist(state))
  const restored = await Effect.runPromise(service.restore())

  expect(Option.getOrUndefined(restored)).toEqual(state)
  expect(await Effect.runPromise(kv.get(path))).toContain('"main"')
})

test("WindowState persists through KeyValueStore without touching the filesystem", async () => {
  const path = await tempWindowStatePath()
  const { kv, service } = await makeFixture({ path })

  await Effect.runPromise(service.persist(state))

  expect(await Effect.runPromise(kv.has(path))).toBe(true)
})

test("WindowState rejects empty window ids before reading durable state", async () => {
  const path = await tempWindowStatePath()
  const { kv } = await makeFixture({ path, now: () => 1710000000000 })
  await Effect.runPromise(kv.set(path, "{"))

  const exit = await Effect.runPromiseExit(
    makeWindowState("", { path, now: () => 1710000000000 }).pipe(
      Effect.provide(Layer.succeed(KeyValueStore.KeyValueStore, kv))
    )
  )

  expectInvalidArgument(exit, "WindowState.make")
  expect(await Effect.runPromise(kv.get(path))).toBe("{")
})

test("WindowState rejects whitespace-only window ids", async () => {
  const path = await tempWindowStatePath()

  const exit = await Effect.runPromiseExit(
    makeWindowState("   ", { path }).pipe(Effect.provide(KeyValueStore.layerMemory))
  )

  expectInvalidArgument(exit, "WindowState.make")
})

test("WindowState rejects every C0 control byte and DEL in window ids", async () => {
  const path = await tempWindowStatePath()
  const { kv } = await makeFixture({ path })

  for (let codePoint = 0; codePoint <= 31; codePoint += 1) {
    const windowId = `main${String.fromCharCode(codePoint)}forged`
    const exit = await Effect.runPromiseExit(
      makeWindowState(windowId, { path }).pipe(
        Effect.provide(Layer.succeed(KeyValueStore.KeyValueStore, kv))
      )
    )
    expectInvalidArgument(exit, "WindowState.make")
  }
  const delId = `main${String.fromCharCode(127)}forged`
  expectInvalidArgument(
    await Effect.runPromiseExit(
      makeWindowState(delId, { path }).pipe(
        Effect.provide(Layer.succeed(KeyValueStore.KeyValueStore, kv))
      )
    ),
    "WindowState.make"
  )

  expect(await Effect.runPromise(kv.has(path))).toBe(false)
})

test("WindowState default path rejects bundle ids with path traversal", async () => {
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
    expect(() => defaultWindowStatePath(bundleId)).toThrow(WindowStateInvalidArgumentError)
    const exit = await Effect.runPromiseExit(
      Effect.provide(makeWindowState("main", { bundleId }), KeyValueStore.layerMemory)
    )
    expectInvalidBundleId(exit, "WindowState.make")
  }
})

test("WindowState default path accepts bundle ids as namespaces", () => {
  const path = defaultWindowStatePath("com.example.effect-desktop")

  expect(path).toContain("com.example.effect-desktop")
  expect(path.endsWith("window-state.json")).toBe(true)
})

test("WindowState clear removes the current window only", async () => {
  const path = await tempWindowStatePath()
  const { kv, service } = await makeFixture({ path })
  const palette = await makeService("palette", { path }, kv)

  await Effect.runPromise(service.persist(state))
  await Effect.runPromise(palette.persist(state))
  await Effect.runPromise(service.clear())

  expect(await Effect.runPromise(kv.get(path))).not.toContain('"main"')
  expect(await Effect.runPromise(kv.get(path))).toContain('"palette"')
})

test("WindowState restore returns none for a missing window id", async () => {
  const path = await tempWindowStatePath()
  const { service } = await makeFixture({ path })

  const restored = await Effect.runPromise(service.restore())

  expect(Option.isNone(restored)).toBe(true)
})

test("WindowState clears corrupt state and continues with defaults", async () => {
  const path = await tempWindowStatePath()
  const { kv, service } = await makeFixture({ path, now: () => 1710000000000 })
  await Effect.runPromise(kv.set(path, "{"))

  const restored = await Effect.runPromise(service.restore())

  expect(Option.isNone(restored)).toBe(true)
  expect(await Effect.runPromise(kv.has(path))).toBe(false)
})

test("WindowState rejects invalid corrupt recovery timestamps without removing corrupt state", async () => {
  const invalidTimestamps = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]

  for (const timestamp of invalidTimestamps) {
    const path = await tempWindowStatePath()
    const { kv, service } = await makeFixture({ path, now: () => timestamp })
    await Effect.runPromise(kv.set(path, "{"))

    const exit = await Effect.runPromiseExit(service.restore())

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
      expect(fail?.error).toBeInstanceOf(WindowStateReadFailed)
    }
    expect(await Effect.runPromise(kv.get(path))).toBe("{")
  }
})

test("WindowState applies injected bounds validation on restore", async () => {
  const path = await tempWindowStatePath()
  const { service } = await makeFixture({
    path,
    validateBounds: (record) =>
      makeWindowStateRecord({
        x: Math.max(0, record.x),
        y: Math.max(0, record.y)
      })
  })

  await Effect.runPromise(
    service.persist(
      makeWindowStateRecord({
        x: -500,
        y: -400
      })
    )
  )
  const restored = await Effect.runPromise(service.restore())

  expect(Option.getOrThrow(restored).x).toBe(0)
  expect(Option.getOrThrow(restored).y).toBe(0)
})

test("WindowState scopes records by current window id", async () => {
  const path = await tempWindowStatePath()
  const { kv, service } = await makeFixture({ path })
  const palette = await makeService("palette", { path }, kv)

  await Effect.runPromise(service.persist(makeWindowStateRecord({ x: 10 })))
  await Effect.runPromise(palette.persist(makeWindowStateRecord({ x: 900 })))
  const restoredMain = await Effect.runPromise(service.restore())
  const restoredPalette = await Effect.runPromise(palette.restore())

  expect(Option.getOrThrow(restoredMain).x).toBe(10)
  expect(Option.getOrThrow(restoredPalette).x).toBe(900)
})

test("WindowState concurrent persists keep independent records", async () => {
  const path = await tempWindowStatePath()
  const { kv, service } = await makeFixture({ path })
  const palette = await makeService("palette", { path }, kv)

  await Effect.runPromise(
    Effect.all(
      [
        service.persist(makeWindowStateRecord({ x: 10 })),
        palette.persist(makeWindowStateRecord({ x: 900 }))
      ],
      { concurrency: "unbounded" }
    )
  )
  const restoredMain = await Effect.runPromise(service.restore())
  const restoredPalette = await Effect.runPromise(palette.restore())

  expect(Option.getOrThrow(restoredMain).x).toBe(10)
  expect(Option.getOrThrow(restoredPalette).x).toBe(900)
})

test("WindowState concurrent services sharing one path serialize read-modify-write", async () => {
  const path = await tempWindowStatePath()
  const context = await Effect.runPromise(Effect.scoped(Layer.build(KeyValueStore.layerMemory)))
  const kv = Context.get(context, KeyValueStore.KeyValueStore)
  const slowKv: KeyValueStore.KeyValueStore = {
    ...kv,
    get: (key) =>
      kv.get(key).pipe(
        Effect.flatMap((value) => Effect.yieldNow.pipe(Effect.as(value))),
        Effect.flatMap((value) => Effect.yieldNow.pipe(Effect.as(value)))
      )
  }
  const main = await makeService("main", { path }, slowKv)
  const palette = await makeService("palette", { path }, slowKv)

  await Effect.runPromise(
    Effect.all(
      [
        main.persist(makeWindowStateRecord({ x: 10 })),
        palette.persist(makeWindowStateRecord({ x: 900 }))
      ],
      { concurrency: "unbounded" }
    )
  )

  expect(Option.getOrThrow(await Effect.runPromise(main.restore())).x).toBe(10)
  expect(Option.getOrThrow(await Effect.runPromise(palette.restore())).x).toBe(900)
})

test("WindowState snaps off-screen windows to the primary display", async () => {
  const path = await tempWindowStatePath()
  const { service } = await makeFixture({
    path,
    displays: [
      new WindowDisplayBounds({ x: 0, y: 0, width: 1024, height: 768, primary: true }),
      new WindowDisplayBounds({ x: 1024, y: 0, width: 1024, height: 768 })
    ]
  })

  await Effect.runPromise(service.persist(makeWindowStateRecord({ x: 5000, y: 5000 })))
  const restored = await Effect.runPromise(service.restore())

  expect(Option.getOrThrow(restored).x).toBe(0)
  expect(Option.getOrThrow(restored).y).toBe(0)
})

test("WindowState snaps stale display records to the current primary display", async () => {
  const path = await tempWindowStatePath()
  const { service } = await makeFixture({
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

  await Effect.runPromise(
    service.persist(makeWindowStateRecord({ x: 1200, y: 40, displayId: "removed" }))
  )
  const restored = await Effect.runPromise(service.restore())

  expect(Option.getOrThrow(restored)).toMatchObject({
    x: 0,
    y: 0,
    displayId: "primary",
    scaleFactor: 2
  })
})

test("WindowState keeps records visible on their saved display", async () => {
  const path = await tempWindowStatePath()
  const { service } = await makeFixture({
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

  await Effect.runPromise(
    service.persist(makeWindowStateRecord({ x: 1200, y: 40, displayId: "secondary" }))
  )
  const restored = await Effect.runPromise(service.restore())

  expect(Option.getOrThrow(restored)).toMatchObject({
    x: 1200,
    y: 40,
    displayId: "secondary"
  })
})

test("WindowState clear leaves other window records intact", async () => {
  const path = await tempWindowStatePath()
  const { kv, service } = await makeFixture({ path })
  const palette = await makeService("palette", { path }, kv)

  await Effect.runPromise(service.persist(makeWindowStateRecord({ x: 10 })))
  await Effect.runPromise(palette.persist(makeWindowStateRecord({ x: 900 })))
  await Effect.runPromise(service.clear())
  expect(Option.isNone(await Effect.runPromise(service.restore()))).toBe(true)

  const restoredPalette = await Effect.runPromise(palette.restore())
  expect(Option.getOrThrow(restoredPalette).x).toBe(900)
})

test("WindowState observe emits persist, clear, and corrupt recovery events", async () => {
  const path = await tempWindowStatePath()
  const { kv, service } = await makeFixture({ path, now: () => 1710000000000 })
  const fiber = Effect.runFork(service.observe().pipe(Stream.take(3), Stream.runCollect))

  await Effect.runPromise(service.persist(state))
  await Effect.runPromise(service.clear())
  await Effect.runPromise(kv.set(path, "{"))
  await Effect.runPromise(service.restore())
  const events = Array.from(await Effect.runPromise(Fiber.join(fiber)))

  expect(events.map((event) => event.kind)).toEqual(["persisted", "cleared", "corrupt-renamed"])
  expect(events[0]?.windowId).toBe("main")
  expect(events[1]?.windowId).toBe("main")
  expect(events[2]?.corruptPath).toContain("window-state.corrupt.1710000000000.json")
})

test("WindowState rejects non-finite scroll positions", async () => {
  expect(() => makeWindowStateRecord({ scrollPositions: { feed: Number.NaN } })).toThrow()
  expect(() =>
    makeWindowStateRecord({ scrollPositions: { feed: Number.POSITIVE_INFINITY } })
  ).toThrow()
  expect(() =>
    makeWindowStateRecord({ scrollPositions: { feed: Number.NEGATIVE_INFINITY } })
  ).toThrow()
  expect(() => makeWindowStateRecord({ scrollPositions: { feed: 42 } })).not.toThrow()
})

const tempWindowStatePath = async (): Promise<string> => {
  nextPath += 1
  return `window-state-${String(nextPath)}.json`
}

const makeFixture = (
  options: Parameters<typeof makeWindowState>[1] = {}
): Promise<{
  readonly kv: KeyValueStore.KeyValueStore
  readonly service: WindowStateApi
}> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const kv = yield* KeyValueStore.KeyValueStore
      const service = yield* makeWindowState("main", options)
      return { kv, service }
    }).pipe(Effect.provide(KeyValueStore.layerMemory))
  )

const makeService = (
  windowId: string,
  options: Parameters<typeof makeWindowState>[1],
  kv: KeyValueStore.KeyValueStore
): Promise<WindowStateApi> =>
  Effect.runPromise(
    makeWindowState(windowId, options).pipe(
      Effect.provide(Layer.succeed(KeyValueStore.KeyValueStore, kv))
    )
  )

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
