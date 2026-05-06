import { copyFile, mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { describe, expect, test } from "bun:test"

import { Cause, Effect, Exit, Fiber, Option, Schema, Stream } from "effect"

import { makeResourceRegistry } from "./resources.js"
import {
  makeSettings,
  SettingsInvalidArgumentError,
  SettingsMigrationFailedError,
  type SettingsStore
} from "./settings.js"
import { makeSQLite, type SqliteApi } from "./sqlite.js"

const UserName = Schema.String
const Counter = Schema.Number

describe("Settings", () => {
  test("set then get returns a schema-validated value", async () => {
    const { store } = await makeFixture()

    await Effect.runPromise(store.set("user.name", UserName, "alice"))
    const value = await Effect.runPromise(store.get("user.name", UserName))

    expect(Option.getOrUndefined(value)).toBe("alice")
  })

  test("getOrDefault returns the provided default without writing it", async () => {
    const { store } = await makeFixture()

    const value = await Effect.runPromise(store.getOrDefault("theme", UserName, "system"))
    const stored = await Effect.runPromise(store.get("theme", UserName))

    expect(value).toBe("system")
    expect(Option.isNone(stored)).toBe(true)
  })

  test("invalid set value returns typed InvalidArgument before writing", async () => {
    const { store } = await makeFixture()

    const exit = await Effect.runPromiseExit(store.set("counter", Counter, "not-a-number" as never))
    const stored = await Effect.runPromise(store.get("counter", Schema.Unknown))

    expectFailure(exit, SettingsInvalidArgumentError)
    expect(Option.isNone(stored)).toBe(true)
  })

  test("update serializes concurrent read-modify-write calls", async () => {
    const { store } = await makeFixture()

    await Effect.runPromise(store.set("counter", Counter, 0))
    await Effect.runPromise(
      Effect.all(
        Array.from({ length: 20 }, () =>
          store.update("counter", Counter, (current) =>
            Effect.succeed((Option.getOrUndefined(current) ?? 0) + 1)
          )
        ),
        { concurrency: "unbounded" }
      )
    )

    const value = await Effect.runPromise(store.get("counter", Counter))
    expect(Option.getOrUndefined(value)).toBe(20)
  })

  test("changes stream emits old and new values with source", async () => {
    const { store } = await makeFixture()

    const fiber = Effect.runFork(store.changes().pipe(Stream.take(2), Stream.runCollect))
    await Effect.runPromise(store.set("user.name", UserName, "alice", { source: "test" }))
    await Effect.runPromise(store.set("user.name", UserName, "ada", { source: "test" }))
    const changes = Array.from(await Effect.runPromise(Fiber.join(fiber)))

    expect(changes).toEqual([
      { key: "user.name", newValue: "alice", source: "test" },
      { key: "user.name", oldValue: "alice", newValue: "ada", source: "test" }
    ])
  })

  test("registered migration runs in a transaction and emits migration event", async () => {
    const directory = await mkdtemp(join(tmpdir(), "effect-desktop-settings-"))
    const path = join(directory, "settings.sqlite")
    const initial = await makeFixture({ path, schemaVersion: 1 })

    await Effect.runPromise(initial.store.set("user.username", UserName, "alice"))
    await Effect.runPromise(initial.store.close())

    const registry = await Effect.runPromise(makeResourceRegistry())
    const sqlite = await Effect.runPromise(makeSQLite(registry))
    const settings = await Effect.runPromise(makeSettings(sqlite))
    const storeEffect = settings.open({
      path,
      ownerScope: "scope-main",
      schemaVersion: 2,
      migrations: [
        {
          from: 1,
          to: 2,
          migrate: (context) => context.rename("user.username", "user.name")
        }
      ],
      now: () => 10
    })
    const store = await Effect.runPromise(storeEffect)
    const migratedFiber = Effect.runFork(store.migrated().pipe(Stream.take(1), Stream.runCollect))
    const value = await Effect.runPromise(store.get("user.name", UserName))

    expect(Option.getOrUndefined(value)).toBe("alice")
    const migrated = await Effect.runPromise(
      Fiber.join(migratedFiber).pipe(Effect.timeoutOption("10 millis"))
    )

    expect(Option.isSome(migrated)).toBe(true)
    if (Option.isSome(migrated)) {
      expect(Array.from(migrated.value)).toEqual([{ from: 1, to: 2, durationMs: 0 }])
    }
  })

  test("missing migration returns SettingsMigrationFailed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "effect-desktop-settings-"))
    const path = join(directory, "settings.sqlite")
    const initial = await makeFixture({ path, schemaVersion: 1 })

    await Effect.runPromise(initial.store.close())
    const registry = await Effect.runPromise(makeResourceRegistry())
    const sqlite = await Effect.runPromise(makeSQLite(registry))
    const settings = await Effect.runPromise(makeSettings(sqlite))
    const exit = await Effect.runPromiseExit(
      settings.open({ path, ownerScope: "scope-main", schemaVersion: 2 })
    )

    expectFailure(exit, SettingsMigrationFailedError)
  })

  test("corrupt database recovers from an explicit backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "effect-desktop-settings-"))
    const path = join(directory, "settings.sqlite")
    const backupPath = join(directory, "settings.backup.sqlite")
    const initial = await makeFixture({ path, schemaVersion: 1 })

    await Effect.runPromise(initial.store.set("user.name", UserName, "alice"))
    await Effect.runPromise(initial.store.close())
    await copyFile(path, backupPath)
    await writeFile(path, new Uint8Array([1, 2, 3, 4]))

    const recovered = await makeFixture({ path, backupPath, schemaVersion: 1 })
    const value = await Effect.runPromise(recovered.store.get("user.name", UserName))

    expect(Option.getOrUndefined(value)).toBe("alice")
  })
})

async function makeFixture(
  options: {
    readonly path?: string
    readonly backupPath?: string
    readonly schemaVersion?: number
  } = {}
): Promise<{ readonly sqlite: SqliteApi; readonly store: SettingsStore }> {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const sqlite = await Effect.runPromise(makeSQLite(registry))
  const settings = await Effect.runPromise(makeSettings(sqlite))
  const store = await Effect.runPromise(
    settings.open({
      path: options.path ?? ":memory:",
      ownerScope: "scope-main",
      schemaVersion: options.schemaVersion ?? 1,
      ...(options.backupPath === undefined ? {} : { backupPath: options.backupPath })
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
