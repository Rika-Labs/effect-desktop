import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"

import { expect, test } from "bun:test"
import { Effect, Exit, Fiber, Option, Stream } from "effect"

import {
  WindowDisplayBounds,
  WindowStateInvalidArgumentError,
  WindowStateReadFailed,
  WindowStateRecord,
  makeWindowState
} from "./window-state.js"

const state = makeWindowStateRecord()

test("WindowState persists and restores a validated window record", async () => {
  const path = await tempWindowStatePath()
  const service = await Effect.runPromise(makeWindowState({ path }))

  await Effect.runPromise(service.persist("main", state))
  const restored = await Effect.runPromise(service.restore("main"))

  expect(Option.getOrUndefined(restored)).toEqual(state)
  expect(await readFile(path, "utf8")).toContain('"main"')
})

test("WindowState persists without leaving temporary files", async () => {
  const path = await tempWindowStatePath()
  const service = await Effect.runPromise(makeWindowState({ path }))

  await Effect.runPromise(service.persist("main", state))

  const files = await readdir(dirname(path))
  expect(files).toEqual(["window-state.json"])
})

test("WindowState rejects empty window ids on persist before reading durable state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-window-state-"))
  const path = join(directory, "window-state.json")
  await writeFile(path, "{", "utf8")
  const service = await Effect.runPromise(makeWindowState({ path, now: () => 1710000000000 }))

  const exit = await Effect.runPromiseExit(service.persist("", state))

  expectInvalidArgument(exit, "WindowState.persist")
  expect(await readdir(directory)).toEqual(["window-state.json"])
  expect(await readFile(path, "utf8")).toBe("{")
})

test("WindowState rejects empty window ids on restore before reading durable state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-window-state-"))
  const path = join(directory, "window-state.json")
  await writeFile(path, "{", "utf8")
  const service = await Effect.runPromise(makeWindowState({ path, now: () => 1710000000000 }))

  const exit = await Effect.runPromiseExit(service.restore(""))

  expectInvalidArgument(exit, "WindowState.restore")
  expect(await readdir(directory)).toEqual(["window-state.json"])
  expect(await readFile(path, "utf8")).toBe("{")
})

test("WindowState rejects empty window ids on clear before reading durable state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-window-state-"))
  const path = join(directory, "window-state.json")
  await writeFile(path, "{", "utf8")
  const service = await Effect.runPromise(makeWindowState({ path, now: () => 1710000000000 }))

  const exit = await Effect.runPromiseExit(service.clear(""))

  expectInvalidArgument(exit, "WindowState.clear")
  expect(await readdir(directory)).toEqual(["window-state.json"])
  expect(await readFile(path, "utf8")).toBe("{")
})

test("WindowState rejects whitespace-only window ids", async () => {
  const path = await tempWindowStatePath()
  const service = await Effect.runPromise(makeWindowState({ path }))

  const exit = await Effect.runPromiseExit(service.restore("   "))

  expectInvalidArgument(exit, "WindowState.restore")
})

test("WindowState rejects every C0 control byte and DEL in window ids", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-window-state-"))
  const path = join(directory, "window-state.json")
  const service = await Effect.runPromise(makeWindowState({ path }))

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

  expect(await readdir(directory)).toEqual([])
})

test("WindowState clear with no argument wipes the full store", async () => {
  const path = await tempWindowStatePath()
  const service = await Effect.runPromise(makeWindowState({ path }))

  await Effect.runPromise(service.persist("main", state))
  await Effect.runPromise(service.persist("aux", state))
  await Effect.runPromise(service.clear())

  expect(await readFile(path, "utf8")).not.toContain('"main"')
  expect(await readFile(path, "utf8")).not.toContain('"aux"')
})

test("WindowState restore returns none for a missing window id", async () => {
  const path = await tempWindowStatePath()
  const service = await Effect.runPromise(makeWindowState({ path }))

  const restored = await Effect.runPromise(service.restore("missing"))

  expect(Option.isNone(restored)).toBe(true)
})

test("WindowState renames corrupt state files and continues with defaults", async () => {
  const path = await tempWindowStatePath()
  await writeFile(path, "{", "utf8")
  const service = await Effect.runPromise(makeWindowState({ path, now: () => 1710000000000 }))

  const restored = await Effect.runPromise(service.restore("main"))

  expect(Option.isNone(restored)).toBe(true)
  const files = await readdir(join(path, ".."))
  expect(files).toContain("window-state.corrupt.1710000000000.json")
})

test("WindowState returns read failures without rotating healthy files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-window-state-"))
  const service = await Effect.runPromise(makeWindowState({ path: directory }))

  const exit = await Effect.runPromiseExit(service.restore("main"))

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find((reason) => reason._tag === "Fail")
    expect(fail?.error).toBeInstanceOf(WindowStateReadFailed)
  }
  const files = await readdir(directory)
  expect(files.some((file) => file.startsWith("window-state.corrupt."))).toBe(false)
})

test("WindowState applies injected bounds validation on restore", async () => {
  const path = await tempWindowStatePath()
  const service = await Effect.runPromise(
    makeWindowState({
      path,
      validateBounds: (record) =>
        makeWindowStateRecord({
          x: Math.max(0, record.x),
          y: Math.max(0, record.y)
        })
    })
  )

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
  const service = await Effect.runPromise(makeWindowState({ path }))

  await Effect.runPromise(service.persist("main", makeWindowStateRecord({ x: 10 })))
  await Effect.runPromise(service.persist("palette", makeWindowStateRecord({ x: 900 })))
  const restored = await Effect.runPromise(service.restoreAll())

  expect(restored["main"]?.x).toBe(10)
  expect(restored["palette"]?.x).toBe(900)
})

test("WindowState snaps off-screen windows to the primary display", async () => {
  const path = await tempWindowStatePath()
  const service = await Effect.runPromise(
    makeWindowState({
      path,
      displays: [
        new WindowDisplayBounds({ x: 0, y: 0, width: 1024, height: 768, primary: true }),
        new WindowDisplayBounds({ x: 1024, y: 0, width: 1024, height: 768 })
      ]
    })
  )

  await Effect.runPromise(service.persist("main", makeWindowStateRecord({ x: 5000, y: 5000 })))
  const restored = await Effect.runPromise(service.restore("main"))

  expect(Option.getOrThrow(restored).x).toBe(0)
  expect(Option.getOrThrow(restored).y).toBe(0)
})

test("WindowState clear removes one window or the full store", async () => {
  const path = await tempWindowStatePath()
  const service = await Effect.runPromise(makeWindowState({ path }))

  await Effect.runPromise(service.persist("main", makeWindowStateRecord({ x: 10 })))
  await Effect.runPromise(service.persist("palette", makeWindowStateRecord({ x: 900 })))
  await Effect.runPromise(service.clear("main"))
  expect(Object.keys(await Effect.runPromise(service.restoreAll()))).toEqual(["palette"])

  await Effect.runPromise(service.clear())
  expect(await Effect.runPromise(service.restoreAll())).toEqual({})
})

test("WindowState observe emits persist, clear, and corrupt recovery events", async () => {
  const path = await tempWindowStatePath()
  const service = await Effect.runPromise(makeWindowState({ path, now: () => 1710000000000 }))
  const fiber = Effect.runFork(service.observe().pipe(Stream.take(3), Stream.runCollect))

  await Effect.runPromise(service.persist("main", state))
  await Effect.runPromise(service.clear("main"))
  await writeFile(path, "{", "utf8")
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
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-window-state-"))
  return join(directory, "window-state.json")
}

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
