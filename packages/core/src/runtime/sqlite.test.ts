import { describe, expect, test } from "bun:test"

import { Cause, Deferred, Effect, Exit, Fiber, Option } from "effect"

import {
  makeSQLite,
  SqliteConstraintError,
  SqliteInvalidArgumentError,
  SqliteInvalidStateError,
  type SqliteConnection
} from "./sqlite.js"
import { makeResourceRegistry, type ResourceRegistryApi } from "./resources.js"

describe("SQLite", () => {
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
