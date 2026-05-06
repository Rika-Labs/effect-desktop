import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { Cause, Effect, Exit, Fiber, Stream } from "effect"

import {
  EventLogFullError,
  EventLogInvalidArgumentError,
  makeEventLog,
  type EventLogStore
} from "./event-log.js"
import { makeResourceRegistry } from "./resources.js"
import { makeSQLite, type SqliteApi } from "./sqlite.js"

describe("EventLog", () => {
  test("append returns monotonic ids and query replays in order", async () => {
    const { store } = await makeFixture()

    const first = await Effect.runPromise(
      store.append({ type: "user.created", payload: { id: 1 } })
    )
    const second = await Effect.runPromise(
      store.append({ type: "user.updated", payload: { id: 1 } })
    )
    const events = await Effect.runPromise(store.query())

    expect(first).toBe(0)
    expect(second).toBe(1)
    expect(events.map((event) => event.id)).toEqual([0, 1])
    expect(events.map((event) => event.type)).toEqual(["user.created", "user.updated"])
  })

  test("query filters by cursor and type", async () => {
    const { store } = await makeFixture()

    await Effect.runPromise(store.append({ type: "a", payload: { n: 1 } }))
    await Effect.runPromise(store.append({ type: "b", payload: { n: 2 } }))
    await Effect.runPromise(store.append({ type: "b", payload: { n: 3 } }))
    const events = await Effect.runPromise(store.query({ from: 1, type: "b" }))

    expect(events.map((event) => event.id)).toEqual([1, 2])
  })

  test("replay preserves explicit null payloads separately from absent payloads", async () => {
    const { store } = await makeFixture()

    await Effect.runPromise(store.append({ type: "absent" }))
    await Effect.runPromise(store.append({ type: "null", payload: null }))
    const events = await Effect.runPromise(store.query())

    expect(Object.hasOwn(events[0] ?? {}, "payload")).toBe(false)
    expect(Object.hasOwn(events[1] ?? {}, "payload")).toBe(true)
    expect(events[1]?.payload).toBe(null)
  })

  test("concurrent appends allocate one monotonic id sequence", async () => {
    const { store } = await makeFixture()

    const ids = await Effect.runPromise(
      Effect.all(
        Array.from({ length: 20 }, (_value, index) =>
          store.append({ type: "concurrent", payload: { index } })
        ),
        { concurrency: "unbounded" }
      )
    )
    const events = await Effect.runPromise(store.query())

    expect([...ids].sort((left, right) => left - right)).toEqual(
      Array.from({ length: 20 }, (_value, index) => index)
    )
    expect(events.map((event) => event.id)).toEqual(
      Array.from({ length: 20 }, (_value, index) => index)
    )
  })

  test("append persists across reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "effect-desktop-event-log-"))
    const path = join(directory, "events.sqlite")
    const first = await makeFixture({ path })

    await Effect.runPromise(first.store.append({ type: "audit", payload: { ok: true } }))
    await Effect.runPromise(first.store.close())

    const reopened = await makeFixture({ path })
    const events = await Effect.runPromise(reopened.store.query())

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe("audit")
    expect(events[0]?.payload).toEqual({ ok: true })
  })

  test("subscribe replays from cursor then follows the live tail", async () => {
    const { store } = await makeFixture()

    await Effect.runPromise(store.append({ type: "first" }))
    const fiber = Effect.runFork(
      store.subscribe({ from: 0 }).pipe(Stream.take(3), Stream.runCollect)
    )
    await Effect.runPromise(store.append({ type: "second" }))
    await Effect.runPromise(store.append({ type: "third" }))
    const events = Array.from(await Effect.runPromise(Fiber.join(fiber)))

    expect(events.map((event) => event.type)).toEqual(["first", "second", "third"])
  })

  test("subscribe without cursor starts at the live tail", async () => {
    const { store } = await makeFixture()

    await Effect.runPromise(store.append({ type: "before-subscribe" }))
    const fiber = Effect.runFork(store.subscribe().pipe(Stream.take(1), Stream.runCollect))
    await Effect.runPromise(store.append({ type: "after-subscribe" }))
    const events = Array.from(await Effect.runPromise(Fiber.join(fiber)))

    expect(events.map((event) => event.type)).toEqual(["after-subscribe"])
  })

  test("retention keeps only the newest committed events", async () => {
    const { store } = await makeFixture({ maxEvents: 2 })

    await Effect.runPromise(store.append({ type: "one" }))
    await Effect.runPromise(store.append({ type: "two" }))
    await Effect.runPromise(store.append({ type: "three" }))
    const events = await Effect.runPromise(store.query())

    expect(events.map((event) => event.type)).toEqual(["two", "three"])
  })

  test("invalid append input returns typed InvalidArgument before writing", async () => {
    const { store } = await makeFixture()

    const exit = await Effect.runPromiseExit(store.append({ type: "", payload: { ok: true } }))
    const events = await Effect.runPromise(store.query())

    expectFailure(exit, EventLogInvalidArgumentError)
    expect(events).toHaveLength(0)
  })

  test("read-only meta state returns EventLogFull and preserves query", async () => {
    const directory = await mkdtemp(join(tmpdir(), "effect-desktop-event-log-"))
    const path = join(directory, "events.sqlite")
    const { sqlite, store } = await makeFixture({ path })

    await Effect.runPromise(store.append({ type: "before-full" }))
    const control = await Effect.runPromise(
      sqlite.connect({ path, ownerScope: "scope-control", strict: true })
    )
    await Effect.runPromise(
      control.exec("UPDATE event_log_meta SET read_only = 1 WHERE namespace = ?", ["default"])
    )
    await Effect.runPromise(control.close())
    const exit = await Effect.runPromiseExit(store.append({ type: "after-full" }))
    const events = await Effect.runPromise(store.query())

    expectFailure(exit, EventLogFullError)
    expect(events.map((event) => event.type)).toEqual(["before-full"])
  })
})

async function makeFixture(
  options: {
    readonly path?: string
    readonly maxEvents?: number
  } = {}
): Promise<{ readonly sqlite: SqliteApi; readonly store: EventLogStore }> {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const sqlite = await Effect.runPromise(makeSQLite(registry))
  const store = await Effect.runPromise(
    Effect.gen(function* () {
      const eventLog = yield* makeEventLog(sqlite)
      return yield* eventLog.open({
        path: options.path ?? ":memory:",
        ownerScope: "scope-main",
        ...(options.maxEvents === undefined ? {} : { maxEvents: options.maxEvents })
      })
    })
  )

  return { sqlite, store }
}
function expectFailure<E>(
  exit: Exit.Exit<unknown, E>,
  errorClass: abstract new (...args: never[]) => E
): void {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    const error = failure?.error
    expect(error).toBeInstanceOf(errorClass)
  }
}
