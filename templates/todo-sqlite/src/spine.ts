import { realpath } from "node:fs/promises"

import {
  Desktop,
  PermissionRegistry,
  ResourceRegistry,
  SqlClientLive,
  makePermissionRegistry,
  makeResourceRegistry
} from "@effect-desktop/core"
import { Effect, Layer, Schema } from "effect"
import { Reactivity } from "effect/unstable/reactivity"
import { Model } from "effect/unstable/schema"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import * as SqlModel from "effect/unstable/sql/SqlModel"

import { AppRpc, TODO_REACTIVITY_KEY, Todo, type Todo as TodoType } from "./contract.js"

class TodoRow extends Model.Class<TodoRow>("TodoRow")({
  id: Model.GeneratedByApp(Schema.NonEmptyString),
  title: Schema.NonEmptyString,
  done: Schema.Boolean,
  createdAt: Schema.Number
}) {}

const repoEffect = Effect.gen(function* () {
  const sql = yield* SqlClient

  yield* sql`
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL
    )
  `.pipe(Effect.orDie)

  const repo = yield* SqlModel.makeRepository(TodoRow, {
    tableName: "todos",
    spanPrefix: "Todo",
    idColumn: "id"
  }).pipe(Effect.orDie)

  const toTodo = (row: TodoRow): Effect.Effect<TodoType, never, never> =>
    Schema.decodeUnknownEffect(Todo)({
      id: row.id,
      title: row.title,
      done: row.done,
      createdAt: row.createdAt
    }).pipe(Effect.orDie)

  const handlerLayer = AppRpc.toLayer({
    CreateTodo: ({ title }) =>
      Reactivity.mutation(
        Effect.gen(function* () {
          const id = globalThis.crypto.randomUUID()
          const row = yield* repo
            .insert({ id, title, done: false, createdAt: Date.now() })
            .pipe(Effect.orDie)
          return yield* toTodo(row)
        }),
        [TODO_REACTIVITY_KEY]
      ),

    ListTodos: () =>
      Effect.gen(function* () {
        const rows = yield* sql<TodoRow>`SELECT * FROM todos ORDER BY createdAt DESC`.pipe(
          Effect.orDie
        )
        return yield* Effect.forEach(rows, toTodo)
      }),

    CompleteTodo: ({ id }) =>
      Reactivity.mutation(
        sql`UPDATE todos SET done = 1 WHERE id = ${id as string}`.pipe(Effect.asVoid, Effect.orDie),
        [TODO_REACTIVITY_KEY]
      ),

    DeleteTodo: ({ id }) =>
      Reactivity.mutation(
        sql`DELETE FROM todos WHERE id = ${id as string}`.pipe(Effect.asVoid, Effect.orDie),
        [TODO_REACTIVITY_KEY]
      )
  })

  return handlerLayer.pipe(
    Layer.provide(Reactivity.layer),
    Layer.provide(Layer.succeed(SqlClient, sql))
  )
}).pipe(Effect.orDie)

const registryLayer: Layer.Layer<ResourceRegistry> = Layer.unwrap(
  Effect.map(makeResourceRegistry(), (registry) => Layer.succeed(ResourceRegistry, registry))
)

const permissionLayer = Layer.unwrap(
  Effect.gen(function* () {
    const permissions = yield* makePermissionRegistry()
    const root = yield* Effect.tryPromise(() => realpath(".")).pipe(Effect.orDie)
    yield* permissions.declare({ kind: "sqlite.open", roots: [root], audit: "always" })
    return Layer.succeed(PermissionRegistry, permissions)
  })
)

const sqlLayer = SqlClientLive({ filename: "todos.db", ownerScope: "main" }).pipe(
  Layer.provide(permissionLayer),
  Layer.provide(registryLayer)
)

const todoLayer = Layer.unwrap(repoEffect.pipe(Effect.provide(sqlLayer)))

export const TodoApp = Desktop.make({
  id: "todo-sqlite",
  windows: {
    main: {
      title: "Todos",
      width: 960,
      height: 640,
      renderer: "/"
    }
  },
  rpcs: [Desktop.Rpcs.layer(AppRpc, todoLayer)]
})

export const MainLayer = Desktop.app(TodoApp)
