import { describe, expect, test } from "bun:test"
import { access, mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { Model } from "effect/unstable/schema"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import * as SqlModel from "effect/unstable/sql/SqlModel"

import {
  makePermissionRegistry,
  PermissionDeniedError,
  PermissionRegistry
} from "./permission-registry.js"
import { ResourceOwner } from "./resource-owner.js"
import { makeResourceRegistry, ResourceRegistry, type ResourceRegistryApi } from "./resources.js"
import { SqlClientLive, SqliteInvalidArgumentError } from "./sqlite.js"

describe("SqlClientLive", () => {
  test("SqlClient executes a raw query against in-memory SQLite", async () => {
    const { layer } = await makeFixture({ filename: ":memory:" })
    const program = Effect.gen(function* () {
      const sql = yield* SqlClient
      return yield* sql`SELECT 1 AS value`
    })

    const rows = await Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(layer))))

    expect(rows).toEqual([{ value: 1 }])
  })

  test("rejects invalid layer input before opening a database", async () => {
    const registry = await Effect.runPromise(makeResourceRegistry())
    const permissions = await Effect.runPromise(makePermissionRegistry())
    const layer = SqlClientLive({ filename: "" }).pipe(
      Layer.provide(Layer.succeed(ResourceRegistry, registry)),
      Layer.provide(Layer.succeed(PermissionRegistry, permissions)),
      Layer.provide(ResourceOwner.test("scope-sql"))
    )

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const sql = yield* SqlClient
          yield* sql`SELECT 1`
        }).pipe(Effect.provide(layer))
      )
    )

    expectFailure(exit, SqliteInvalidArgumentError)
    expect((await Effect.runPromise(registry.list())).entries).toHaveLength(0)
  })

  test("denies file-backed database paths without sqlite.open permission before creating files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "effect-desktop-sqlite-denied-"))
    const databasePath = join(directory, "blocked.sqlite")
    const registry = await Effect.runPromise(makeResourceRegistry())
    const permissions = await Effect.runPromise(
      makePermissionRegistry({ traceId: () => "trace-sqlite" })
    )
    const layer = SqlClientLive({
      filename: databasePath,
      create: true
    }).pipe(
      Layer.provide(Layer.succeed(ResourceRegistry, registry)),
      Layer.provide(Layer.succeed(PermissionRegistry, permissions)),
      Layer.provide(ResourceOwner.test("scope-main"))
    )

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const sql = yield* SqlClient
          yield* sql`SELECT 1`
        }).pipe(Effect.provide(layer))
      )
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
    const layer = SqlClientLive({
      filename: databasePath,
      create: true
    }).pipe(
      Layer.provide(Layer.succeed(ResourceRegistry, registry)),
      Layer.provide(Layer.succeed(PermissionRegistry, permissions)),
      Layer.provide(ResourceOwner.test("scope-main"))
    )

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sql = yield* SqlClient
          yield* sql`CREATE TABLE items (name TEXT)`
        }).pipe(Effect.provide(layer))
      )
    )
    const decisions = await Effect.runPromise(permissions.listDecisions())

    expect(decisions.map((decision) => decision.outcome)).toEqual(["granted"])
    expect(decisions[0]?.capability.kind).toBe("sqlite.open")
    expect(await exists(databasePath)).toBe(true)
  })

  test("rejects NUL bytes in SQLite paths before opening a database", async () => {
    const registry = await Effect.runPromise(makeResourceRegistry())
    const permissions = await Effect.runPromise(makePermissionRegistry())
    const layer = SqlClientLive({
      filename: ":memory:\u0000shadow"
    }).pipe(
      Layer.provide(Layer.succeed(ResourceRegistry, registry)),
      Layer.provide(Layer.succeed(PermissionRegistry, permissions)),
      Layer.provide(ResourceOwner.test("scope-main"))
    )

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const sql = yield* SqlClient
          yield* sql`SELECT 1`
        }).pipe(Effect.provide(layer))
      )
    )

    expectFailure(exit, SqliteInvalidArgumentError)
    expect((await Effect.runPromise(registry.list())).entries).toHaveLength(0)
  })

  test("registers a sqlite resource while the layer scope is open and removes it on close", async () => {
    const registry = await Effect.runPromise(makeResourceRegistry())
    const { layer } = await makeFixture({ filename: ":memory:", registry })
    const program = Effect.gen(function* () {
      const sql = yield* SqlClient
      yield* sql`SELECT 1`
      return yield* registry.list()
    })

    const duringScope = await Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(layer))))
    const afterScope = await Effect.runPromise(registry.list())

    expect(duringScope.entries.some((entry) => entry.handle.kind === "sqlite")).toBe(true)
    expect(afterScope.entries).toHaveLength(0)
  })

  test("ResourceRegistry.closeScope closes the scoped SqlClient", async () => {
    const registry = await Effect.runPromise(makeResourceRegistry())
    const { layer } = await makeFixture({ filename: ":memory:", registry })
    const program = Effect.gen(function* () {
      const sql = yield* SqlClient
      yield* sql`CREATE TABLE users (name TEXT)`
      yield* registry.closeScope("scope-sql")
      const afterClose = yield* registry.list()
      const queryExit = yield* Effect.exit(sql`SELECT name FROM users`)
      return { afterClose, queryExit }
    })

    const result = await Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(layer))))

    expect(result.afterClose.entries).toHaveLength(0)
    expect(Exit.isFailure(result.queryExit)).toBe(true)
  })

  test("SqlClient transactions roll back failed programs", async () => {
    const { layer } = await makeFixture({ filename: ":memory:" })
    const program = Effect.gen(function* () {
      const sql = yield* SqlClient
      yield* sql`CREATE TABLE users (name TEXT)`
      const exit = yield* Effect.exit(
        sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`INSERT INTO users (name) VALUES (${"Ada"})`
            return yield* Effect.fail("rollback")
          })
        )
      )
      const rows = yield* sql`SELECT name FROM users`
      return { exit, rows }
    })

    const result = await Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(layer))))

    expect(Exit.isFailure(result.exit)).toBe(true)
    expect(result.rows).toEqual([])
  })

  test("Model.makeRepository round-trips a row through SqlClient", async () => {
    class Item extends Model.Class<Item>("Item")({
      id: Model.Generated(Schema.Number),
      name: Schema.NonEmptyString
    }) {}

    const { layer } = await makeFixture({ filename: ":memory:" })
    const program = Effect.gen(function* () {
      const sql = yield* SqlClient
      yield* sql`CREATE TABLE item (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`

      const repo = yield* SqlModel.makeRepository(Item, {
        tableName: "item",
        spanPrefix: "Item",
        idColumn: "id"
      })

      const inserted = yield* repo.insert({ name: "widget" })
      return yield* repo.findById(inserted.id)
    })

    const item = await Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(layer))))

    expect(item.name).toBe("widget")
    expect(typeof item.id).toBe("number")
  })
})

async function makeFixture(config: {
  readonly filename: string
  readonly registry?: ResourceRegistryApi
}) {
  const registry = config.registry ?? (await Effect.runPromise(makeResourceRegistry()))
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const layer = SqlClientLive({
    filename: config.filename
  }).pipe(
    Layer.provide(Layer.succeed(ResourceRegistry, registry)),
    Layer.provide(Layer.succeed(PermissionRegistry, permissions)),
    Layer.provide(ResourceOwner.test("scope-sql"))
  )

  return { registry, layer }
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

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
