import { useDesktop } from "@effect-desktop/react"
import { Option } from "effect"
import { useRef, useState } from "react"

import type { Todo } from "./contract.js"
import { todoTemplateMessages as copy } from "./messages.js"

type AppState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Ready"; readonly todos: readonly Todo[] }
  | { readonly _tag: "Error"; readonly message: string }

export function App() {
  const desktop = useDesktop()
  const [state] = useState<AppState>({ _tag: "Idle" })
  const [input, setInput] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const todos = state._tag === "Ready" ? state.todos : []

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-zinc-950 dark:text-zinc-50">
      <section className="mx-auto w-full max-w-2xl px-6 py-12">
        <p className="text-sm font-semibold uppercase tracking-normal text-emerald-700 dark:text-emerald-300">
          {copy.eyebrow}
        </p>
        <h1 className="mt-2 text-3xl font-semibold">{copy.title}</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-zinc-400">
          {copy.descriptionStart}{" "}
          <code className="rounded bg-slate-100 px-1 dark:bg-zinc-800">Model.Class</code> +{" "}
          <code className="rounded bg-slate-100 px-1 dark:bg-zinc-800">makeRepository</code>.
          {copy.descriptionEnd}{" "}
          <code className="rounded bg-slate-100 px-1 dark:bg-zinc-800">Reactivity.mutation</code>.
        </p>

        <div className="mt-6 flex gap-2">
          <input
            ref={inputRef}
            className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
            placeholder={copy.placeholder}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
            }}
          />
          <button
            className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-zinc-700"
            disabled={input.trim() === "" || Option.isNone(desktop)}
            type="button"
          >
            {copy.add}
          </button>
        </div>

        <ul className="mt-4 space-y-2" data-testid="todo-list">
          {state._tag === "Idle" && (
            <li className="text-sm text-slate-500 dark:text-zinc-500">{copy.connecting}</li>
          )}
          {state._tag === "Error" && (
            <li className="text-sm text-red-600 dark:text-red-400">{state.message}</li>
          )}
          {todos.map((todo) => (
            <li
              key={todo.id}
              className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span
                className={`flex-1 text-sm ${todo.done ? "text-slate-400 line-through dark:text-zinc-600" : "text-slate-900 dark:text-zinc-100"}`}
              >
                {todo.title}
              </span>
            </li>
          ))}
          {state._tag === "Ready" && todos.length === 0 && (
            <li className="text-sm text-slate-500 dark:text-zinc-500">{copy.empty}</li>
          )}
        </ul>
      </section>
    </main>
  )
}
