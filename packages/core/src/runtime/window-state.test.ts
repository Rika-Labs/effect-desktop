import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { expect, test } from "bun:test"
import { Effect, Exit, Option } from "effect"

import { WindowStateReadFailed, WindowStateRecord, makeWindowState } from "./window-state.js"

const state = makeWindowStateRecord()

test("WindowState persists and restores a validated window record", async () => {
  const path = await tempWindowStatePath()
  const service = await Effect.runPromise(makeWindowState({ path }))

  await Effect.runPromise(service.persist("main", state))
  const restored = await Effect.runPromise(service.restore("main"))

  expect(Option.getOrUndefined(restored)).toEqual(state)
  expect(await readFile(path, "utf8")).toContain('"main"')
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

const tempWindowStatePath = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-window-state-"))
  return join(directory, "window-state.json")
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
