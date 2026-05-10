import { Rpc, RpcGroup } from "@effect-desktop/bridge"
import { Schema } from "effect"

export const TodoId = Schema.String.pipe(Schema.brand("TodoId"))
export type TodoId = Schema.Schema.Type<typeof TodoId>

export const Todo = Schema.Struct({
  id: TodoId,
  title: Schema.NonEmptyString,
  done: Schema.Boolean,
  createdAt: Schema.Number
})
export type Todo = Schema.Schema.Type<typeof Todo>

export const CreateTodoRpc = Rpc.make("CreateTodo", {
  payload: { title: Schema.NonEmptyString },
  success: Todo
})

export const ListTodosRpc = Rpc.make("ListTodos", {
  success: Schema.Array(Todo)
})

export const CompleteTodoRpc = Rpc.make("CompleteTodo", {
  payload: { id: TodoId },
  success: Schema.Void
})

export const DeleteTodoRpc = Rpc.make("DeleteTodo", {
  payload: { id: TodoId },
  success: Schema.Void
})

export const AppRpc = RpcGroup.make(CreateTodoRpc, ListTodosRpc, CompleteTodoRpc, DeleteTodoRpc)

export const TODO_REACTIVITY_KEY = "todos"
