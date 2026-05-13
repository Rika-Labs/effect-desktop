import { expect, test } from "bun:test"
import { Effect, Exit, Fiber, Option, Stream } from "effect"
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

  await Effect.runPromise(service.persist("main", state))
  const restored = await Effect.runPromise(service.restore("main"))

  expect(Option.getOrUndefined(restored)).toEqual(state)
  expect(await Effect.runPromise(kv.get(path))).toContain('"main"')
})

test("WindowState persists through KeyValueStore without touching the filesystem", async () => {
  const path = await tempWindowStatePath()
  const { kv, service } = await makeFixture({ path })

  await Effect.runPromise(service.persist("main", state))

  expect(await Effect.runPromise(kv.has(path))).toBe(true)
})

test("WindowState rejects empty window ids on persist before reading durable state", async () => {
  const path = await tempWindowStatePath()
  const { kv, service } = await makeFixture({ path, now: () => 1710000000000 })
  await Effect.runPromise(kv.set(path, "{"))

  const exit = await Effect.runPromiseExit(service.persist("", state))

  expectInvalidArgument(exit, "WindowState.persist")
  expect(await Effect.runPromise(kv.get(path))).toBe("{")
})

test("WindowState rejects empty window ids on restore before reading durable state", async () => {
  const path = await tempWindowStatePath()
  const { kv, service } = await makeFixture({ path, now: () => 1710000000000 })
  await Effect.runPromise(kv.set(path, "{"))

  const exit = await Effect.runPromiseExit(service.restore(""))

  expectInvalidArgument(exit, "WindowState.restore")
  expect(await Effect.runPromise(kv.get(path))).toBe("{")
})

test("WindowState rejects empty window ids on clear before reading durable state", async () => {
  const path = await tempWindowStatePath()
  const { kv, service } = await makeFixture({ path, now: () => 1710000000000 })
  await Effect.runPromise(kv.set(path, "{"))

  const exit = await Effect.runPromiseExit(service.clear(""))

  expectInvalidArgument(exit, "WindowState.clear")
  expect(await Effect.runPromise(kv.get(path))).toBe("{")
})

test("WindowState rejects whitespace-only window ids", async () => {
  const path = await tempWindowStatePath()
  const { service } = await makeFixture({ path })

  const exit = await Effect.runPromiseExit(service.restore("   "))

  expectInvalidArgument(exit, "WindowState.restore")
})

test("WindowState rejects every C0 control byte and DEL in window ids", async () => {
  const path = await tempWindowStatePath()
  const { kv, service } = await makeFixture({ path })

  for (let codePoint = 0; codePoint <= 31; codePoint += 1) {
    const windowId = `main${String.fromCharCode(codePoint)}forged`
    const persistExit = await Effect.runPromiseExit(service.persist(windowId, state))
    const restoreExit = await Effect.runPromiseExit(service.restore(windowId))
    const clearExit = await Effect.runPromiseExit(service.clear(windowId))
    expectInvalidArgument(persistExit, "WindowState.persist")
    expectInvalidArgument(restoreExit, "WindowState.restore")
    expectInvalidArgument(clearExit, "WindowState.clear")
  }
  const delId = `main${String.fromCharCode(127)}forged`
  expectInvalidArgument(
    await Effect.runPromiseExit(service.persist(delId, state)),
    "WindowState.persist"
  )
  expectInvalidArgument(await Effect.runPromiseExit(service.restore(delId)), "WindowState.restore")
  expectInvalidArgument(await Effect.runPromiseExit(service.clear(delId)), "WindowState.clear")

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
      Effect.provide(makeWindowState({ bundleId }), KeyValueStore.layerMemory)
    )
    expectInvalidBundleId(exit, "WindowState.make")
  }
})

test("WindowState default path accepts bundle ids as namespaces", () => {
  const path = defaultWindowStatePath("com.example.effect-desktop")

  expect(path).toContain("com.example.effect-desktop")
  expect(path.endsWith("window-state.json")).toBe(true)
})

test("WindowState clear with no argument wipes the full store", async () => {
  const path = await tempWindowStatePath()
  const { kv, service } = await makeFixture({ path })

  await Effect.runPromise(service.persist("main", state))
  await Effect.runPromise(service.persist("aux", state))
  await Effect.runPromise(service.clear())

  expect(await Effect.runPromise(kv.get(path))).not.toContain('"main"')
  expect(await Effect.runPromise(kv.get(path))).not.toContain('"aux"')
})

test("WindowState restore returns none for a missing window id", async () => {
  const path = await tempWindowStatePath()
  const { service } = await makeFixture({ path })

  const restored = await Effect.runPromise(service.restore("missing"))

  expect(Option.isNone(restored)).toBe(true)
})

test("WindowState clears corrupt state and continues with defaults", async () => {
  const path = await tempWindowStatePath()
  const { kv, service } = await makeFixture({ path, now: () => 1710000000000 })
  await Effect.runPromise(kv.set(path, "{"))

  const restored = await Effect.runPromise(service.restore("main"))

  expect(Option.isNone(restored)).toBe(true)
  expect(await Effect.runPromise(kv.has(path))).toBe(false)
})

test("WindowState rejects invalid corrupt recovery timestamps without removing corrupt state", async () => {
  const invalidTimestamps = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]

  for (const timestamp of invalidTimestamps) {
    const path = await tempWindowStatePath()
    const { kv, service } = await makeFixture({ path, now: () => timestamp })
    await Effect.runPromise(kv.set(path, "{"))

    const exit = await Effect.runPromiseExit(service.restore("main"))

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
      "main",
      makeWindowStateRecord({
        x: -500,
        y: -400
      })
    )
  )
  const restored = await Effect.runPromise(service.restore("main"))

  expect(Option.getOrThrow(restored).x).toBe(0)
  expect(Option.getOrThrow(restored).y).toBe(0)
})

test("WindowState restores all windows independently", async () => {
  const path = await tempWindowStatePath()
  const { service } = await makeFixture({ path })

  await Effect.runPromise(service.persist("main", makeWindowStateRecord({ x: 10 })))
  await Effect.runPromise(service.persist("palette", makeWindowStateRecord({ x: 900 })))
  const restored = await Effect.runPromise(service.restoreAll())

  expect(restored["main"]?.x).toBe(10)
  expect(restored["palette"]?.x).toBe(900)
})

test("WindowState concurrent persists keep independent records", async () => {
  const path = await tempWindowStatePath()
  const { service } = await makeFixture({ path })

  await Effect.runPromise(
    Effect.all(
      [
        service.persist("main", makeWindowStateRecord({ x: 10 })),
        service.persist("palette", makeWindowStateRecord({ x: 900 }))
      ],
      { concurrency: "unbounded" }
    )
  )
  const restored = await Effect.runPromise(service.restoreAll())

  expect(Object.keys(restored).sort()).toEqual(["main", "palette"])
  expect(restored["main"]?.x).toBe(10)
  expect(restored["palette"]?.x).toBe(900)
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

  await Effect.runPromise(service.persist("main", makeWindowStateRecord({ x: 5000, y: 5000 })))
  const restored = await Effect.runPromise(service.restore("main"))

  expect(Option.getOrThrow(restored).x).toBe(0)
  expect(Option.getOrThrow(restored).y).toBe(0)
})

test("WindowState clear removes one window or the full store", async () => {
  const path = await tempWindowStatePath()
  const { service } = await makeFixture({ path })

  await Effect.runPromise(service.persist("main", makeWindowStateRecord({ x: 10 })))
  await Effect.runPromise(service.persist("palette", makeWindowStateRecord({ x: 900 })))
  await Effect.runPromise(service.clear("main"))
  expect(Object.keys(await Effect.runPromise(service.restoreAll()))).toEqual(["palette"])

  await Effect.runPromise(service.clear())
  expect(await Effect.runPromise(service.restoreAll())).toEqual({})
})

test("WindowState observe emits persist, clear, and corrupt recovery events", async () => {
  const path = await tempWindowStatePath()
  const { kv, service } = await makeFixture({ path, now: () => 1710000000000 })
  const fiber = Effect.runFork(service.observe().pipe(Stream.take(3), Stream.runCollect))

  await Effect.runPromise(service.persist("main", state))
  await Effect.runPromise(service.clear("main"))
  await Effect.runPromise(kv.set(path, "{"))
  await Effect.runPromise(service.restore("main"))
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
  options: Parameters<typeof makeWindowState>[0] = {}
): Promise<{
  readonly kv: KeyValueStore.KeyValueStore
  readonly service: WindowStateApi
}> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const kv = yield* KeyValueStore.KeyValueStore
      const service = yield* makeWindowState(options)
      return { kv, service }
    }).pipe(Effect.provide(KeyValueStore.layerMemory))
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
    isFullScreen: overrides.isFullScreen ?? false,
    scaleFactor: overrides.scaleFactor ?? 2,
    zoom: overrides.zoom ?? 1,
    ...(overrides.devtoolsPanel === undefined ? {} : { devtoolsPanel: overrides.devtoolsPanel }),
    ...(overrides.scrollPositions === undefined
      ? {}
      : { scrollPositions: overrides.scrollPositions })
  })
}
