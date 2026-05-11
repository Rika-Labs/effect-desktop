import { Desktop, mutation, ReactivityLayer, SqlClientLive } from "@effect-desktop/core"
import { Effect, Layer, Schema } from "effect"
import { Model } from "effect/unstable/schema"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import * as SqlModel from "effect/unstable/sql/SqlModel"
import { makeResourceRegistry, ResourceRegistry } from "@effect-desktop/core"

import { AppRpc, TODO_REACTIVITY_KEY, type Todo, type TodoId } from "./contract.js"

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

  const toTodo = (row: TodoRow): Todo => ({
    id: row.id as unknown as TodoId,
    title: row.title,
    done: row.done,
    createdAt: row.createdAt
  })

  const handlerLayer = AppRpc.toLayer({
    CreateTodo: ({ title }) =>
      mutation(
        Effect.gen(function* () {
          const id = globalThis.crypto.randomUUID()
          const row = yield* repo
            .insert({ id, title, done: false, createdAt: Date.now() })
            .pipe(Effect.orDie)
          return toTodo(row)
        }),
        [TODO_REACTIVITY_KEY]
      ),

    ListTodos: () =>
      Effect.gen(function* () {
        const rows = yield* sql<TodoRow>`SELECT * FROM todos ORDER BY createdAt DESC`.pipe(
          Effect.orDie
        )
        return rows.map(toTodo)
      }),

    CompleteTodo: ({ id }) =>
      mutation(
        sql`UPDATE todos SET done = 1 WHERE id = ${id as string}`.pipe(Effect.asVoid, Effect.orDie),
        [TODO_REACTIVITY_KEY]
      ),

    DeleteTodo: ({ id }) =>
      mutation(
        sql`DELETE FROM todos WHERE id = ${id as string}`.pipe(Effect.asVoid, Effect.orDie),
        [TODO_REACTIVITY_KEY]
      )
  })

  return handlerLayer.pipe(
    Layer.provide(ReactivityLayer),
    Layer.provide(Layer.succeed(SqlClient, sql))
  )
}).pipe(Effect.orDie)

const registryLayer: Layer.Layer<ResourceRegistry> = Layer.unwrap(
  Effect.map(makeResourceRegistry(), (registry) => Layer.succeed(ResourceRegistry, registry))
)

const sqlLayer = SqlClientLive({ filename: "todos.db", ownerScope: "main" }).pipe(
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
  }
}).pipe(Desktop.provide(Desktop.Rpcs.layer(AppRpc, todoLayer)))

export const MainLayer = Desktop.toLayer(TodoApp)
