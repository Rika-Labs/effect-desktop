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
  type SettingsError,
  type SettingsMigrationContext,
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

  test("keys returns namespace-local keys in stable order", async () => {
    const { store } = await makeFixture()

    await Effect.runPromise(store.set("z.token", UserName, "last"))
    await Effect.runPromise(store.set("a.token", UserName, "first"))

    expect(await Effect.runPromise(store.keys())).toEqual(["a.token", "z.token"])
  })

  test("delete removes a setting and emits a change event", async () => {
    const { store } = await makeFixture()
    const fiber = Effect.runFork(store.changes().pipe(Stream.take(2), Stream.runCollect))

    await Effect.runPromise(store.set("api.token", UserName, "secret", { source: "seed" }))
    await Effect.runPromise(store.delete("api.token", { source: "migration" }))
    const stored = await Effect.runPromise(store.get("api.token", UserName))
    const changes = Array.from(await Effect.runPromise(Fiber.join(fiber)))

    expect(Option.isNone(stored)).toBe(true)
    expect(changes).toEqual([
      { key: "api.token", newValue: "secret", source: "seed" },
      { key: "api.token", oldValue: "secret", source: "migration" }
    ])
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

  test("set rejects NUL bytes in keys before writing", async () => {
    const { store } = await makeFixture()
    const key = `api${String.fromCharCode(0)}token`

    const exit = await Effect.runPromiseExit(store.set(key, UserName, "secret"))

    expectFailure(exit, SettingsInvalidArgumentError)
    expect(await Effect.runPromise(store.keys())).toEqual([])
  })

  test("set rejects every C0 control byte and DEL in keys", async () => {
    const { store } = await makeFixture()

    for (const codePoint of [0x00, 0x09, 0x0a, 0x0d, 0x1b, 0x7f]) {
      const key = `api${String.fromCharCode(codePoint)}token`
      const exit = await Effect.runPromiseExit(store.set(key, UserName, "secret"))
      expectFailure(exit, SettingsInvalidArgumentError)
    }
    expect(await Effect.runPromise(store.keys())).toEqual([])
  })

  test("update rejects NUL bytes in keys before opening transaction", async () => {
    const { store } = await makeFixture()
    const key = `api${String.fromCharCode(0)}token`

    const exit = await Effect.runPromiseExit(
      store.update(key, UserName, () => Effect.succeed("secret"))
    )

    expectFailure(exit, SettingsInvalidArgumentError)
    expect(await Effect.runPromise(store.keys())).toEqual([])
  })

  test("migration setRaw rejects NUL bytes in keys before writing", async () => {
    const key = `api${String.fromCharCode(0)}token`
    const { exit, keys } = await runFailingMigration((ctx) => ctx.setRaw(key, "x"))

    expectMigrationFailedDueToInvalidArgument(exit)
    expect(keys).toEqual([])
  })

  test("migration rename rejects NUL bytes in the target key before writing", async () => {
    const to = `api${String.fromCharCode(0)}token`
    const { exit, keys } = await runFailingMigration(
      (ctx) => ctx.rename("api.token", to),
      (store) => store.set("api.token", UserName, "secret")
    )

    expectMigrationFailedDueToInvalidArgument(exit)
    expect(keys).toEqual(["api.token"])
  })

  test("get rejects empty keys", async () => {
    const { store } = await makeFixture()

    const exit = await Effect.runPromiseExit(store.get("", UserName))

    expectFailure(exit, SettingsInvalidArgumentError)
  })

  test("delete rejects empty keys", async () => {
    const { store } = await makeFixture()

    const exit = await Effect.runPromiseExit(store.delete(""))

    expectFailure(exit, SettingsInvalidArgumentError)
  })

  test("get drains a legacy control-byte-bearing row persisted by older builds", async () => {
    const legacyKey = `api${String.fromCharCode(0)}token`
    const { store } = await makeFixtureWithLegacyKey(legacyKey, "secret")

    const value = await Effect.runPromise(store.get(legacyKey, UserName))

    expect(Option.getOrUndefined(value)).toBe("secret")
  })

  test("delete drains a legacy control-byte-bearing row persisted by older builds", async () => {
    const legacyKey = `api${String.fromCharCode(0)}token`
    const { store } = await makeFixtureWithLegacyKey(legacyKey, "secret")

    await Effect.runPromise(store.delete(legacyKey))

    expect(await Effect.runPromise(store.keys())).toEqual([])
  })

  test("migration getRaw drains a legacy control-byte-bearing row", async () => {
    const legacyKey = `api${String.fromCharCode(0)}token`
    const observedRef: { value: Option.Option<unknown> } = { value: Option.none() }
    const { exit } = await runMigrationOnSeededDb(legacyKey, "secret", (ctx) =>
      Effect.gen(function* () {
        observedRef.value = yield* ctx.getRaw(legacyKey)
      })
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(observedRef.value).toEqual(Option.some("secret"))
  })

  test("migration deleteRaw drains a legacy control-byte-bearing row", async () => {
    const legacyKey = `api${String.fromCharCode(0)}token`
    const { exit, keysAfter } = await runMigrationOnSeededDb(legacyKey, "secret", (ctx) =>
      ctx.deleteRaw(legacyKey)
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(keysAfter).toEqual([])
  })

  test("migration rename relocates a legacy control-byte-bearing row to a valid key", async () => {
    const legacyKey = `api${String.fromCharCode(0)}token`
    const { exit, keysAfter, valueAtNewKey } = await runMigrationOnSeededDb(
      legacyKey,
      "secret",
      (ctx) => ctx.rename(legacyKey, "api.token")
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(keysAfter).toEqual(["api.token"])
    expect(valueAtNewKey).toBe("secret")
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

async function runFailingMigration(
  migrate: (ctx: SettingsMigrationContext) => Effect.Effect<void, SettingsError, never>,
  seed?: (store: SettingsStore) => Effect.Effect<unknown, SettingsError, never>
): Promise<{
  readonly exit: Exit.Exit<SettingsStore, SettingsError>
  readonly keys: readonly string[]
}> {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-settings-"))
  const path = join(directory, "settings.sqlite")
  const initial = await makeFixture({ path, schemaVersion: 1 })
  if (seed !== undefined) {
    await Effect.runPromise(seed(initial.store))
  }
  await Effect.runPromise(initial.store.close())

  const registry = await Effect.runPromise(makeResourceRegistry())
  const sqlite = await Effect.runPromise(makeSQLite(registry))
  const settings = await Effect.runPromise(makeSettings(sqlite))
  const exit = await Effect.runPromiseExit(
    settings.open({
      path,
      ownerScope: "scope-main",
      schemaVersion: 2,
      migrations: [{ from: 1, to: 2, migrate }]
    })
  )

  const after = await makeFixture({ path, schemaVersion: 1 })
  const keys = await Effect.runPromise(after.store.keys())
  await Effect.runPromise(after.store.close())

  return { exit, keys }
}

function expectMigrationFailedDueToInvalidArgument(exit: Exit.Exit<unknown, SettingsError>): void {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    const error = failure?.error
    expect(error).toBeInstanceOf(SettingsMigrationFailedError)
    if (error instanceof SettingsMigrationFailedError) {
      expect(Option.isSome(error.cause)).toBe(true)
      if (Option.isSome(error.cause)) {
        expect(error.cause.value).toBeInstanceOf(SettingsInvalidArgumentError)
      }
    }
  }
}

async function makeFixtureWithLegacyKey(
  legacyKey: string,
  value: string
): Promise<{ readonly sqlite: SqliteApi; readonly store: SettingsStore }> {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-settings-"))
  const path = join(directory, "settings.sqlite")
  const initial = await makeFixture({ path, schemaVersion: 1 })
  await Effect.runPromise(initial.store.close())
  await seedLegacyKey(path, legacyKey, value)
  return makeFixture({ path, schemaVersion: 1 })
}

async function runMigrationOnSeededDb(
  legacyKey: string,
  value: string,
  migrate: (ctx: SettingsMigrationContext) => Effect.Effect<void, SettingsError, never>
): Promise<{
  readonly exit: Exit.Exit<SettingsStore, SettingsError>
  readonly keysAfter: readonly string[]
  readonly valueAtNewKey: string | undefined
}> {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-settings-"))
  const path = join(directory, "settings.sqlite")
  const initial = await makeFixture({ path, schemaVersion: 1 })
  await Effect.runPromise(initial.store.close())
  await seedLegacyKey(path, legacyKey, value)

  const registry = await Effect.runPromise(makeResourceRegistry())
  const sqlite = await Effect.runPromise(makeSQLite(registry))
  const settings = await Effect.runPromise(makeSettings(sqlite))
  const exit = await Effect.runPromiseExit(
    settings.open({
      path,
      ownerScope: "scope-main",
      schemaVersion: 2,
      migrations: [{ from: 1, to: 2, migrate }]
    })
  )

  const after = await makeFixture({ path, schemaVersion: 2 })
  const keysAfter = await Effect.runPromise(after.store.keys())
  let valueAtNewKey: string | undefined
  if (keysAfter.length === 1) {
    const onlyKey = keysAfter[0]
    if (onlyKey !== undefined && onlyKey !== legacyKey) {
      const v = await Effect.runPromise(after.store.get(onlyKey, UserName))
      valueAtNewKey = Option.getOrUndefined(v)
    }
  }
  await Effect.runPromise(after.store.close())

  return { exit, keysAfter, valueAtNewKey }
}

async function seedLegacyKey(path: string, key: string, value: string): Promise<void> {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const sqlite = await Effect.runPromise(makeSQLite(registry))
  const connection = await Effect.runPromise(
    sqlite.connect({ path, ownerScope: "scope-test-seed", create: false, strict: true })
  )
  await Effect.runPromise(
    connection.exec(
      "INSERT INTO settings_values (namespace, key, value_json, updated_at_ms) VALUES (?, ?, ?, ?)",
      ["default", key, JSON.stringify(value), Date.now()]
    )
  )
  await Effect.runPromise(connection.close())
}
