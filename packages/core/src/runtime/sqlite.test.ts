import { describe, expect, test } from "bun:test"
import { access, mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option, Schema } from "effect"
import { Model } from "effect/unstable/schema"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import * as SqlModel from "effect/unstable/sql/SqlModel"

import { makeResourceRegistry, ResourceRegistry, type ResourceRegistryApi } from "./resources.js"
import { makePermissionRegistry, PermissionDeniedError } from "./permission-registry.js"
import {
  makeSQLite,
  SqlClientLive,
  SqliteConstraintError,
  SqliteInvalidArgumentError,
  SqliteInvalidStateError,
  type SqliteConnection
} from "./sqlite.js"

describe("SQLite (bespoke)", () => {
  test("connects to an in-memory database and queries rows", async () => {
    const { connection } = await makeFixture()

    const rows = await Effect.runPromise(connection.query("SELECT 1"))

    expect(rows).toEqual([{ "1": 1 }])
  })

  test("rejects invalid connect input before opening a database", async () => {
    const registry = await Effect.runPromise(makeResourceRegistry())
    const service = await Effect.runPromise(makeSQLite(registry))

    const exit = await Effect.runPromiseExit(
      service.connect({ path: "", ownerScope: "scope-main" })
    )
    const snapshot = await Effect.runPromise(registry.list())

    expectFailure(exit, SqliteInvalidArgumentError)
    expect(snapshot.entries).toHaveLength(0)
  })

  test("denies file-backed database paths without sqlite.open permission before creating files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "effect-desktop-sqlite-denied-"))
    const databasePath = join(directory, "blocked.sqlite")
    const registry = await Effect.runPromise(makeResourceRegistry())
    const permissions = await Effect.runPromise(
      makePermissionRegistry({ traceId: () => "trace-sqlite" })
    )
    const service = await Effect.runPromise(makeSQLite(registry, { permissions }))

    const exit = await Effect.runPromiseExit(
      service.connect({ path: databasePath, ownerScope: "scope-main", create: true })
    )
    const snapshot = await Effect.runPromise(registry.list())
    const decisions = await Effect.runPromise(permissions.listDecisions())

    expectFailure(exit, PermissionDeniedError)
    expect(snapshot.entries).toHaveLength(0)
    expect(decisions.map((decision) => decision.outcome)).toEqual(["denied"])
    expect(decisions[0]?.capability.kind).toBe("sqlite.open")
    expect(await exists(databasePath)).toBe(false)
  })

  test("opens file-backed database paths inside a declared sqlite.open root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "effect-desktop-sqlite-allowed-"))
    const root = await realpath(directory)
    const databasePath = join(directory, "allowed.sqlite")
    const registry = await Effect.runPromise(makeResourceRegistry())
    const permissions = await Effect.runPromise(
      makePermissionRegistry({ traceId: () => "trace-sqlite", nextToken: () => "grant-sqlite" })
    )
    await Effect.runPromise(
      permissions.declare({ kind: "sqlite.open", roots: [root], audit: "always" })
    )
    const service = await Effect.runPromise(makeSQLite(registry, { permissions }))

    const connection = await Effect.runPromise(
      service.connect({ path: databasePath, ownerScope: "scope-main", create: true })
    )
    await Effect.runPromise(connection.exec("CREATE TABLE items (name TEXT)"))
    await Effect.runPromise(connection.close())
    const decisions = await Effect.runPromise(permissions.listDecisions())

    expect(decisions.map((decision) => decision.outcome)).toEqual(["granted"])
    expect(decisions[0]?.capability.kind).toBe("sqlite.open")
    expect(await exists(databasePath)).toBe(true)
  })

  test("rejects NUL bytes in SQLite paths before opening a database", async () => {
    const registry = await Effect.runPromise(makeResourceRegistry())
    const service = await Effect.runPromise(makeSQLite(registry))

    const exit = await Effect.runPromiseExit(
      service.connect({ path: ":memory:\u0000shadow", ownerScope: "scope-main" })
    )
    const snapshot = await Effect.runPromise(registry.list())

    expectFailure(exit, SqliteInvalidArgumentError)
    expect(snapshot.entries).toHaveLength(0)
  })

  test("exec returns change counts", async () => {
    const { connection } = await makeFixture()

    await Effect.runPromise(
      connection.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
    )
    const changes = await Effect.runPromise(
      connection.exec("INSERT INTO users (name) VALUES (?)", ["Ada"])
    )

    expect(changes.changes).toBe(1)
    expect(changes.lastInsertRowid).toBe(1)
  })

  test("SQLite rejects undefined parameters before the driver boundary", async () => {
    const { connection } = await makeFixture()

    await Effect.runPromise(connection.exec("CREATE TABLE users (name TEXT)"))
    const statement = await Effect.runPromise(
      connection.prepare("INSERT INTO users (name) VALUES ($name)")
    )
    const queryExit = await Effect.runPromiseExit(
      connection.query("SELECT $name AS name", { name: undefined } as never)
    )
    const execExit = await Effect.runPromiseExit(
      connection.exec("INSERT INTO users (name) VALUES ($name)", { name: undefined } as never)
    )
    const statementExit = await Effect.runPromiseExit(statement.run({ name: undefined } as never))
    const nullExit = await Effect.runPromiseExit(
      connection.exec("INSERT INTO users (name) VALUES ($name)", { name: null })
    )
    const rows = await Effect.runPromise(connection.query("SELECT name FROM users"))

    expectFailure(queryExit, SqliteInvalidArgumentError)
    expectFailure(execExit, SqliteInvalidArgumentError)
    expectFailure(statementExit, SqliteInvalidArgumentError)
    expect(Exit.isSuccess(nullExit)).toBe(true)
    expect(rows).toEqual([{ name: null }])
  })

  test("successful transaction commits", async () => {
    const { connection } = await makeFixture()

    await Effect.runPromise(connection.exec("CREATE TABLE users (name TEXT)"))
    await Effect.runPromise(
      connection.transaction(
        Effect.gen(function* () {
          yield* connection.exec("INSERT INTO users (name) VALUES (?)", ["Ada"])
          yield* connection.exec("INSERT INTO users (name) VALUES (?)", ["Grace"])
        })
      )
    )

    const rows = await Effect.runPromise(connection.query("SELECT name FROM users ORDER BY name"))
    expect(rows).toEqual([{ name: "Ada" }, { name: "Grace" }])
  })

  test("SQLite rejects unknown transaction modes before issuing SQL", async () => {
    const { connection } = await makeFixture()

    await Effect.runPromise(connection.exec("CREATE TABLE users (name TEXT)"))
    const invalidExit = await Effect.runPromiseExit(
      connection.transaction(Effect.void, { mode: "bogus" } as never)
    )
    for (const mode of ["deferred", "immediate", "exclusive"] as const) {
      await Effect.runPromise(
        connection.transaction(connection.exec("INSERT INTO users (name) VALUES (?)", [mode]), {
          mode
        })
      )
    }
    const rows = await Effect.runPromise(connection.query("SELECT name FROM users ORDER BY rowid"))

    expectFailure(invalidExit, SqliteInvalidArgumentError)
    expect(rows).toEqual([{ name: "deferred" }, { name: "immediate" }, { name: "exclusive" }])
  })

  test("failed transaction rolls back without throwing", async () => {
    const { connection } = await makeFixture()
    const failure = new SqliteInvalidArgumentError({
      field: "test",
      operation: "test",
      resource: "test",
      message: "boom",
      code: Option.none(),
      cause: Option.none()
    })

    await Effect.runPromise(connection.exec("CREATE TABLE users (name TEXT)"))
    const exit = await Effect.runPromiseExit(
      connection.transaction(
        Effect.gen(function* () {
          yield* connection.exec("INSERT INTO users (name) VALUES (?)", ["Ada"])
          return yield* Effect.fail(failure)
        })
      )
    )
    const rows = await Effect.runPromise(connection.query("SELECT name FROM users"))

    expectFailure(exit, SqliteInvalidArgumentError)
    expect(rows).toEqual([])
  })

  test("prepared statement runs repeatedly and closes with its scope", async () => {
    const { connection, registry } = await makeFixture()

    await Effect.runPromise(connection.exec("CREATE TABLE users (name TEXT)"))
    const statement = await Effect.runPromise(
      connection.prepare("INSERT INTO users (name) VALUES ($name)")
    )

    await Effect.runPromise(statement.run({ name: "Ada" }))
    await Effect.runPromise(statement.run({ name: "Grace" }))
    const rows = await Effect.runPromise(connection.query("SELECT name FROM users ORDER BY name"))

    expect(rows).toEqual([{ name: "Ada" }, { name: "Grace" }])
    expect(
      (await Effect.runPromise(registry.list())).entries.map((entry) => entry.handle.kind)
    ).toEqual(["sqlite", "sqlite-statement"])

    await Effect.runPromise(registry.closeScope("scope-main"))

    expect((await Effect.runPromise(registry.list())).entries).toHaveLength(0)
  })

  test("prepared statements can run inside a transaction", async () => {
    const { connection } = await makeFixture()

    await Effect.runPromise(connection.exec("CREATE TABLE users (name TEXT)"))
    const statement = await Effect.runPromise(
      connection.prepare("INSERT INTO users (name) VALUES ($name)")
    )

    await Effect.runPromise(
      connection.transaction(
        Effect.gen(function* () {
          yield* statement.run({ name: "Ada" })
          yield* statement.run({ name: "Grace" })
        })
      )
    )

    const rows = await Effect.runPromise(connection.query("SELECT name FROM users ORDER BY name"))
    expect(rows).toEqual([{ name: "Ada" }, { name: "Grace" }])
  })

  test("outside fibers wait while a transaction owns the connection", async () => {
    const { connection } = await makeFixture()

    await Effect.runPromise(connection.exec("CREATE TABLE users (name TEXT)"))
    const started = await Effect.runPromise(Deferred.make<void>())
    const release = await Effect.runPromise(Deferred.make<void>())

    const program = Effect.gen(function* () {
      const transactionFiber = yield* connection
        .transaction(
          Effect.gen(function* () {
            yield* connection.exec("INSERT INTO users (name) VALUES (?)", ["tx-before"])
            yield* Deferred.succeed(started, undefined)
            yield* Deferred.await(release)
            yield* connection.exec("INSERT INTO users (name) VALUES (?)", ["tx-after"])
          })
        )
        .pipe(Effect.forkChild({ startImmediately: true }))

      yield* Deferred.await(started)
      const outsideFiber = yield* connection
        .exec("INSERT INTO users (name) VALUES (?)", ["outside"])
        .pipe(Effect.forkChild({ startImmediately: true }))
      const blockedOutside = yield* Fiber.join(outsideFiber).pipe(Effect.timeoutOption("10 millis"))

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(transactionFiber)
      yield* Fiber.join(outsideFiber)

      return blockedOutside
    })

    const blockedOutside = await Effect.runPromise(program)
    const rows = await Effect.runPromise(connection.query("SELECT name FROM users ORDER BY rowid"))

    expect(Option.isNone(blockedOutside)).toBe(true)
    expect(rows).toEqual([{ name: "tx-before" }, { name: "tx-after" }, { name: "outside" }])
  })

  test("closing a scope closes the connection and removes its resource", async () => {
    const { connection, registry } = await makeFixture()

    await Effect.runPromise(connection.exec("CREATE TABLE users (name TEXT)"))
    await Effect.runPromise(registry.closeScope("scope-main"))

    expect((await Effect.runPromise(registry.list())).entries).toHaveLength(0)
    const exit = await Effect.runPromiseExit(connection.query("SELECT name FROM users"))

    expectFailure(exit, SqliteInvalidStateError)
  })

  test("constraint failures map to SqliteError.Constraint", async () => {
    const { connection } = await makeFixture()

    await Effect.runPromise(connection.exec("CREATE TABLE users (name TEXT UNIQUE)"))
    await Effect.runPromise(connection.exec("INSERT INTO users (name) VALUES (?)", ["Ada"]))
    const exit = await Effect.runPromiseExit(
      connection.exec("INSERT INTO users (name) VALUES (?)", ["Ada"])
    )

    expectFailure(exit, SqliteConstraintError)
  })
})

describe("SqlClientLive (effect/unstable/sql)", () => {
  test("SqlClient executes a raw query against in-memory database", async () => {
    const program = Effect.gen(function* () {
      const sql = yield* SqlClient
      const rows = yield* sql`SELECT 1 AS value`
      return rows
    })

    const registry = await Effect.runPromise(makeResourceRegistry())
    const layer = SqlClientLive({ filename: ":memory:", ownerScope: "scope-sql" }).pipe(
      Layer.provide(Layer.succeed(ResourceRegistry, registry))
    )

    const rows = await Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(layer))))
    expect(rows).toEqual([{ value: 1 }])
  })

  test("SqlClientLive registers a sqlite resource in ResourceRegistry", async () => {
    const program = Effect.gen(function* () {
      const sql = yield* SqlClient
      yield* sql`SELECT 1`
    })

    const registry = await Effect.runPromise(makeResourceRegistry())
    const layer = SqlClientLive({ filename: ":memory:", ownerScope: "scope-sql" }).pipe(
      Layer.provide(Layer.succeed(ResourceRegistry, registry))
    )

    await Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(layer))))

    const snapshot = await Effect.runPromise(registry.list())
    expect(snapshot.entries.some((e) => e.handle.kind === "sqlite")).toBe(true)
  })

  test("Model.makeRepository round-trips a row through SqlClient", async () => {
    class Item extends Model.Class<Item>("Item")({
      id: Model.Generated(Schema.Number),
      name: Schema.NonEmptyString
    }) {}

    const program = Effect.gen(function* () {
      const sql = yield* SqlClient
      yield* sql`CREATE TABLE item (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`

      const repo = yield* SqlModel.makeRepository(Item, {
        tableName: "item",
        spanPrefix: "Item",
        idColumn: "id"
      })

      const inserted = yield* repo.insert({ name: "widget" })
      const found = yield* repo.findById(inserted.id)
      return found
    })

    const registry = await Effect.runPromise(makeResourceRegistry())
    const layer = SqlClientLive({ filename: ":memory:", ownerScope: "scope-model" }).pipe(
      Layer.provide(Layer.succeed(ResourceRegistry, registry))
    )

    const item = await Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(layer))))
    expect(item.name).toBe("widget")
    expect(typeof item.id).toBe("number")
  })
})

async function makeFixture(): Promise<{
  readonly registry: ResourceRegistryApi
  readonly connection: SqliteConnection
}> {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const service = await Effect.runPromise(makeSQLite(registry))
  const connection = await Effect.runPromise(
    service.connect({ path: ":memory:", ownerScope: "scope-main", strict: true })
  )

  return { registry, connection }
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

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  )
