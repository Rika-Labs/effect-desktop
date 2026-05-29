import { describe, expect, test } from "bun:test"

import {
  Cause,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  ManagedRuntime,
  Option,
  Path,
  Schema,
  Stream
} from "effect"
import { KeyValueStore } from "effect/unstable/persistence"
import { BunServices } from "@effect/platform-bun"

import { makePermissionRegistry, PermissionRegistry } from "./permission-registry.js"
import { ResourceOwner } from "./resource-owner.js"
import { makeResourceRegistry, ResourceRegistry } from "./resources.js"
import {
  makeSettings,
  Settings,
  SettingsInvalidArgumentError,
  SettingsMigrationFailedError,
  type SettingsMutationOptions,
  type SettingsError,
  type SettingsMigrationContext,
  type SettingsStore
} from "./settings.js"

const UserName = Schema.String
const Counter = Schema.Number

const BunServicesRuntime = ManagedRuntime.make(BunServices.layer)

const makeKvMemory = (): Effect.Effect<KeyValueStore.KeyValueStore> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(KeyValueStore.layerMemory)
    return yield* Effect.promise(() => runtime.runPromise(KeyValueStore.KeyValueStore.asEffect()))
  })

const makeKvYielding = (): KeyValueStore.KeyValueStore => {
  const map = new Map<string, string>()
  return KeyValueStore.makeStringOnly({
    get: (key) => Effect.yieldNow.pipe(Effect.as(map.get(key))),
    set: (key, value) =>
      Effect.yieldNow.pipe(Effect.flatMap(() => Effect.sync(() => void map.set(key, value)))),
    remove: (key) => Effect.sync(() => void map.delete(key)),
    clear: Effect.sync(() => map.clear()),
    size: Effect.sync(() => map.size)
  })
}

const makePersistentSettingsLayer = (
  path: string,
  options: Omit<Parameters<typeof Settings.layer>[0], "path"> = { schemaVersion: 1 }
) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.realPath(pathService.dirname(path))
    const registry = yield* makeResourceRegistry()
    const permissions = yield* makePermissionRegistry()
    yield* permissions.declare({ kind: "sqlite.open", roots: [root], audit: "always" })

    return Settings.layer({ path, ...options }).pipe(
      Layer.provide(Layer.succeed(ResourceRegistry, registry)),
      Layer.provide(Layer.succeed(PermissionRegistry, permissions)),
      Layer.provide(ResourceOwner.test("scope-settings")),
      Layer.provide(BunServices.layer)
    )
  })

const withTempSettingsPath = <A, E>(
  use: (path: string) => Effect.Effect<A, E, never>
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(() =>
      BunServicesRuntime.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          return yield* fs.makeTempDirectory({ prefix: "effect-desktop-settings-" })
        })
      )
    )
    const path = `${directory}/settings.sqlite`
    return yield* use(path)
  })

const provideBunServices = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>
): Effect.Effect<A, E, never> =>
  Effect.promise(() => BunServicesRuntime.runPromise(effect)) as Effect.Effect<A, E, never>

test("Settings mutation option decoding does not assert absent options", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        Bun.file(new URL("./settings.ts", import.meta.url)).text()
      )

      expect(source).not.toContain("undefined as SettingsMutationOptions | undefined")
    })
  ))

test("Settings does not expose shallow window aliases", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        Bun.file(new URL("./settings.ts", import.meta.url)).text()
      )

      expect(source).not.toContain("static window(")
      expect(source).not.toContain("Settings.window")
    })
  ))

describe("Settings", () => {
  test("set then get returns a schema-validated value", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()

        yield* store.set("user.name", UserName, "alice")
        const value = yield* store.get("user.name", UserName)

        expect(Option.getOrUndefined(value)).toBe("alice")
      })
    ))

  test("getOrDefault returns the provided default without writing it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()

        const value = yield* store.getOrDefault("theme", UserName, "system")
        const stored = yield* store.get("theme", UserName)

        expect(value).toBe("system")
        expect(Option.isNone(stored)).toBe(true)
      })
    ))

  test("typed setting keys carry name schema and default together", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()
        const Theme = store.key({
          name: "theme",
          schema: Schema.Literals(["light", "dark", "system"]),
          defaultValue: "system"
        })

        const defaultTheme = yield* store.getOrDefault(Theme)
        yield* store.set(Theme, "dark")
        const stored = yield* store.get(Theme)

        expect(defaultTheme).toBe("system")
        expect(Option.getOrUndefined(stored)).toBe("dark")
      })
    ))

  test("keys returns namespace-local keys in stable order", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()

        yield* store.set("z.token", UserName, "last")
        yield* store.set("a.token", UserName, "first")

        expect(yield* store.keys()).toEqual(["a.token", "z.token"])
      })
    ))

  test("delete removes a setting and emits a change event", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()
        const fiber = yield* store
          .changes()
          .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }))

        yield* store.set("api.token", UserName, "secret", { source: "seed" })
        yield* store.delete("api.token", { source: "migration" })
        const stored = yield* store.get("api.token", UserName)
        const changes = Array.from(yield* Fiber.join(fiber))

        expect(Option.isNone(stored)).toBe(true)
        expect(changes).toEqual([
          { key: "api.token", newValue: "secret", source: "seed" },
          { key: "api.token", oldValue: "secret", source: "migration" }
        ])
      })
    ))

  test("invalid set value returns typed InvalidArgument before writing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()

        const exit = yield* Effect.exit(store.set("counter", Counter, "not-a-number"))
        const stored = yield* store.get("counter", Schema.Unknown)

        expectFailure(exit, SettingsInvalidArgumentError)
        expect(Option.isNone(stored)).toBe(true)
      })
    ))

  test("raw set rejects invalid mutation options before writing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()

        const exit = yield* Effect.exit(
          store.set("user.name", UserName, "alice", malformedMutationOptions())
        )
        const stored = yield* store.get("user.name", UserName)

        expectFailure(exit, SettingsInvalidArgumentError)
        expect(Option.isNone(stored)).toBe(true)
      })
    ))

  test("delete rejects invalid mutation options before deleting", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()

        yield* store.set("api.token", UserName, "secret")
        const exit = yield* Effect.exit(store.delete("api.token", malformedMutationOptions()))
        const stored = yield* store.get("api.token", UserName)

        expectFailure(exit, SettingsInvalidArgumentError)
        expect(Option.getOrUndefined(stored)).toBe("secret")
      })
    ))

  test("update rejects invalid mutation options before writing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()

        yield* store.set("user.name", UserName, "alice")
        const exit = yield* Effect.exit(
          store.update(
            "user.name",
            UserName,
            () => Effect.succeed("ada"),
            malformedMutationOptions()
          )
        )
        const stored = yield* store.get("user.name", UserName)

        expectFailure(exit, SettingsInvalidArgumentError)
        expect(Option.getOrUndefined(stored)).toBe("alice")
      })
    ))

  test("unserializable set values return typed InvalidArgument before writing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()

        for (const value of [() => undefined, Symbol("bad")]) {
          const exit = yield* Effect.exit(store.set("bad", Schema.Unknown, value))
          const stored = yield* store.get("bad", Schema.Unknown)
          const keys = yield* store.keys()

          expectFailure(exit, SettingsInvalidArgumentError)
          expect(Option.isNone(stored)).toBe(true)
          expect(keys).toEqual([])
        }
      })
    ))

  test("update serializes concurrent read-modify-write calls", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()

        yield* store.set("counter", Counter, 0)
        yield* Effect.all(
          Array.from({ length: 20 }, () =>
            store.update("counter", Counter, (current) =>
              Effect.succeed((Option.getOrUndefined(current) ?? 0) + 1)
            )
          ),
          { concurrency: "unbounded" }
        )

        const value = yield* store.get("counter", Counter)
        expect(Option.getOrUndefined(value)).toBe(20)
      })
    ))

  test("update serializes concurrent read-modify-write against an async KV", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const kv = makeKvYielding()
        const store = yield* makeSettings(kv, { schemaVersion: 1 })

        yield* store.set("counter", Counter, 0)
        yield* Effect.all(
          Array.from({ length: 20 }, () =>
            store.update("counter", Counter, (current) =>
              Effect.succeed((Option.getOrUndefined(current) ?? 0) + 1)
            )
          ),
          { concurrency: "unbounded" }
        )

        const value = yield* store.get("counter", Counter)
        expect(Option.getOrUndefined(value)).toBe(20)
      })
    ))

  test("changes stream emits old and new values with source", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()

        const fiber = yield* store
          .changes()
          .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true }))
        yield* store.set("user.name", UserName, "alice", { source: "test" })
        yield* store.set("user.name", UserName, "ada", { source: "test" })
        const changes = Array.from(yield* Fiber.join(fiber))

        expect(changes).toEqual([
          { key: "user.name", newValue: "alice", source: "test" },
          { key: "user.name", oldValue: "alice", newValue: "ada", source: "test" }
        ])
      })
    ))

  test("close terminates open changes streams", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()
        const fiber = yield* store
          .changes()
          .pipe(Stream.runCollect, Effect.forkChild({ startImmediately: true }))

        yield* store.close()
        const result = yield* Fiber.join(fiber).pipe(Effect.timeoutOption("10 millis"))

        expect(Option.isSome(result)).toBe(true)
        if (Option.isSome(result)) {
          expect(Array.from(result.value)).toEqual([])
        }
      })
    ))

  test("close terminates open migration streams", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()
        const fiber = yield* store
          .migrated()
          .pipe(Stream.runCollect, Effect.forkChild({ startImmediately: true }))

        yield* store.close()
        const result = yield* Fiber.join(fiber).pipe(Effect.timeoutOption("10 millis"))

        expect(Option.isSome(result)).toBe(true)
        if (Option.isSome(result)) {
          expect(Array.from(result.value)).toEqual([])
        }
      })
    ))

  test("close is idempotent", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()

        yield* store.close()
        yield* store.close()
      })
    ))

  test("registered migration runs and emits migration event", () =>
    Effect.runPromise(
      withTempSettingsPath((path) =>
        Effect.gen(function* () {
          const layer = yield* provideBunServices(makePersistentSettingsLayer(path))
          const seedRuntime = ManagedRuntime.make(layer)
          try {
            yield* Effect.promise(() =>
              seedRuntime.runPromise(
                Effect.gen(function* () {
                  const store1 = yield* Settings
                  yield* store1.set("user.username", UserName, "alice")
                })
              )
            )
          } finally {
            yield* Effect.promise(() => seedRuntime.dispose())
          }

          const layerWithMigration = yield* provideBunServices(
            makePersistentSettingsLayer(path, {
              schemaVersion: 2,
              migrations: [
                { from: 1, to: 2, migrate: (ctx) => ctx.rename("user.username", "user.name") }
              ],
              now: () => 10
            })
          )
          const migrationRuntime = ManagedRuntime.make(layerWithMigration)
          let result: { value: Option.Option<string>; migrated: Option.Option<unknown> }
          try {
            result = yield* Effect.promise(() =>
              migrationRuntime.runPromise(
                Effect.gen(function* () {
                  const store2 = yield* Settings
                  const migratedFiber = yield* store2
                    .migrated()
                    .pipe(
                      Stream.take(1),
                      Stream.runCollect,
                      Effect.forkChild({ startImmediately: true })
                    )
                  const value = yield* store2.get("user.name", UserName)
                  const migrated = yield* Fiber.join(migratedFiber).pipe(
                    Effect.timeoutOption("10 millis")
                  )
                  return { value, migrated }
                })
              )
            )
          } finally {
            yield* Effect.promise(() => migrationRuntime.dispose())
          }

          expect(Option.getOrUndefined(result.value)).toBe("alice")
          expect(Option.isSome(result.migrated)).toBe(true)
          if (Option.isSome(result.migrated)) {
            expect(Array.from(result.migrated.value as Iterable<unknown>)).toEqual([
              { from: 1, to: 2, durationMs: 0 }
            ])
          }
        })
      )
    ))

  test("migration events clamp negative durations from non-monotonic clocks", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const kv = yield* makeKvMemory()
        let currentTime = 10

        yield* makeSettings(kv, { schemaVersion: 1 })
        const store = yield* makeSettings(kv, {
          schemaVersion: 2,
          migrations: [
            {
              from: 1,
              to: 2,
              migrate: () =>
                Effect.sync(() => {
                  currentTime = 0
                })
            }
          ],
          now: () => currentTime
        })

        const migrated = yield* store.migrated().pipe(Stream.take(1), Stream.runCollect)

        expect(Array.from(migrated)).toEqual([{ from: 1, to: 2, durationMs: 0 }])
      })
    ))

  test("migration events reject non-finite durations as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const kv = yield* makeKvMemory()

        yield* makeSettings(kv, { schemaVersion: 1 })
        const exit = yield* Effect.exit(
          makeSettings(kv, {
            schemaVersion: 2,
            migrations: [{ from: 1, to: 2, migrate: () => Effect.void }],
            now: () => Number.NaN
          })
        )

        expectFailure(exit, SettingsMigrationFailedError)
      })
    ))

  test("missing migration returns SettingsMigrationFailed", () =>
    Effect.runPromise(
      withTempSettingsPath((path) =>
        Effect.gen(function* () {
          const layer = yield* provideBunServices(makePersistentSettingsLayer(path))
          const seedRuntime = ManagedRuntime.make(layer)
          try {
            yield* Effect.promise(() => seedRuntime.runPromise(Settings.asEffect()))
          } finally {
            yield* Effect.promise(() => seedRuntime.dispose())
          }

          const missingMigrationLayer = yield* provideBunServices(
            makePersistentSettingsLayer(path, { schemaVersion: 2 })
          )
          const missingRuntime = ManagedRuntime.make(missingMigrationLayer)
          let missingMigrationExit: Exit.Exit<unknown, unknown>
          try {
            missingMigrationExit = yield* Effect.promise(() =>
              missingRuntime.runPromiseExit(Settings.asEffect())
            )
          } finally {
            yield* Effect.promise(() => missingRuntime.dispose())
          }

          expectFailure(missingMigrationExit, SettingsMigrationFailedError)
        })
      )
    ))

  test("non-advancing migration returns SettingsMigrationFailed", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const kv = yield* makeKvMemory()

        yield* makeSettings(kv, { schemaVersion: 1 })
        const exit = yield* Effect.exit(
          makeSettings(kv, {
            schemaVersion: 2,
            migrations: [{ from: 1, to: 1, migrate: () => Effect.void }]
          })
        )

        expectFailure(exit, SettingsMigrationFailedError)
        if (Exit.isFailure(exit)) {
          const failure = exit.cause.reasons.find(Cause.isFailReason)
          const error = failure?.error
          expect(error).toBeInstanceOf(SettingsMigrationFailedError)
          if (error instanceof SettingsMigrationFailedError) {
            expect(Option.isSome(error.cause)).toBe(true)
            if (Option.isSome(error.cause)) {
              expect(error.cause.value).toBe("non-advancing migration from 1 to 1")
            }
          }
        }
      })
    ))

  test("set rejects NUL bytes in keys before writing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()
        const key = `api${String.fromCharCode(0)}token`

        const exit = yield* Effect.exit(store.set(key, UserName, "secret"))

        expectFailure(exit, SettingsInvalidArgumentError)
        expect(yield* store.keys()).toEqual([])
      })
    ))

  test("set rejects every C0 control byte and DEL in keys", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()

        for (const codePoint of [0x00, 0x09, 0x0a, 0x0d, 0x1b, 0x7f]) {
          const key = `api${String.fromCharCode(codePoint)}token`
          const exit = yield* Effect.exit(store.set(key, UserName, "secret"))
          expectFailure(exit, SettingsInvalidArgumentError)
        }
        expect(yield* store.keys()).toEqual([])
      })
    ))

  test("layer rejects every C0 control byte and DEL in namespace", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const kv = yield* makeKvMemory()

        for (let codePoint = 0; codePoint <= 31; codePoint += 1) {
          const namespace = `settings${String.fromCharCode(codePoint)}forged`
          const exit = yield* Effect.exit(makeSettings(kv, { namespace, schemaVersion: 1 }))
          expectFailure(exit, SettingsInvalidArgumentError)
        }
        const delExit = yield* Effect.exit(
          makeSettings(kv, {
            namespace: `settings${String.fromCharCode(127)}forged`,
            schemaVersion: 1
          })
        )
        expectFailure(delExit, SettingsInvalidArgumentError)
      })
    ))

  test("update rejects NUL bytes in keys before opening transaction", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()
        const key = `api${String.fromCharCode(0)}token`

        const exit = yield* Effect.exit(store.update(key, UserName, () => Effect.succeed("secret")))

        expectFailure(exit, SettingsInvalidArgumentError)
        expect(yield* store.keys()).toEqual([])
      })
    ))

  test("migration setRaw rejects NUL bytes in keys before writing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const key = `api${String.fromCharCode(0)}token`
        const { exit, keys } = yield* runFailingMigration((ctx) => ctx.setRaw(key, "x"))

        expectMigrationFailedDueToInvalidArgument(exit)
        expect(keys).toEqual([])
      })
    ))

  test("migration rename rejects NUL bytes in the target key before writing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const to = `api${String.fromCharCode(0)}token`
        const { exit, keys } = yield* runFailingMigration(
          (ctx) => ctx.rename("api.token", to),
          (store) => store.set("api.token", UserName, "secret")
        )

        expectMigrationFailedDueToInvalidArgument(exit)
        expect(keys).toEqual(["api.token"])
      })
    ))

  test("get rejects empty keys", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()

        const exit = yield* Effect.exit(store.get("", UserName))

        expectFailure(exit, SettingsInvalidArgumentError)
      })
    ))

  test("delete rejects empty keys", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { store } = yield* makeFixture()

        const exit = yield* Effect.exit(store.delete(""))

        expectFailure(exit, SettingsInvalidArgumentError)
      })
    ))

  test("Settings Layer wires SqliteClient.layer for persistence", () =>
    Effect.runPromise(
      withTempSettingsPath((path) =>
        Effect.gen(function* () {
          const program = Effect.gen(function* () {
            const settings = yield* Settings
            yield* settings.set("hello", UserName, "world")
            return yield* settings.get("hello", UserName)
          })

          const layer = yield* provideBunServices(makePersistentSettingsLayer(path))
          const runtime = ManagedRuntime.make(layer)
          let result: Option.Option<string>
          try {
            result = yield* Effect.promise(() => runtime.runPromise(program))
          } finally {
            yield* Effect.promise(() => runtime.dispose())
          }
          expect(Option.getOrUndefined(result)).toBe("world")
        })
      )
    ))

  test("Settings.memory provides in-memory Settings", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Effect.gen(function* () {
          const settings = yield* Settings
          yield* settings.set("key", UserName, "value")
          return yield* settings.get("key", UserName)
        })

        const memoryRuntime = ManagedRuntime.make(Settings.memory())
        let result: Option.Option<string>
        try {
          result = yield* Effect.promise(() => memoryRuntime.runPromise(program))
        } finally {
          yield* Effect.promise(() => memoryRuntime.dispose())
        }
        expect(Option.getOrUndefined(result)).toBe("value")
      })
    ))
})

const makeFixture = (
  options: {
    readonly schemaVersion?: number
  } = {}
) =>
  Effect.gen(function* () {
    const kv = yield* makeKvMemory()
    const store = yield* makeSettings(kv, { schemaVersion: options.schemaVersion ?? 1 })

    return { store }
  })

const malformedMutationOptions = (): SettingsMutationOptions => {
  const options: SettingsMutationOptions = {}
  Object.defineProperty(options, "source", {
    enumerable: true,
    value: 123
  })
  return options
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

const runFailingMigration = (
  migrate: (ctx: SettingsMigrationContext) => Effect.Effect<void, SettingsError, never>,
  seed?: (store: SettingsStore) => Effect.Effect<unknown, SettingsError, never>
) =>
  Effect.gen(function* () {
    const kv = yield* makeKvMemory()
    const initial = yield* makeSettings(kv, { schemaVersion: 1 })
    if (seed !== undefined) {
      yield* seed(initial)
    }

    const exit = yield* Effect.exit(
      makeSettings(kv, {
        schemaVersion: 2,
        migrations: [{ from: 1, to: 2, migrate }]
      })
    )

    const after = yield* makeSettings(kv, { schemaVersion: 1 })
    const keys = yield* after.keys()

    return { exit, keys }
  })

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
