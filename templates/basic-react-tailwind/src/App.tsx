import { useDesktop, useWindow } from "@effect-desktop/react"
import type { WindowCreateOptions } from "@effect-desktop/native"
import { Effect, Exit, Option } from "effect"
import { useState } from "react"

const windowRequest: WindowCreateOptions = Object.freeze({
  title: "basic-react-tailwind",
  width: 960,
  height: 640
})

type WindowState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Running" }
  | { readonly _tag: "Succeeded"; readonly windowId: string }
  | { readonly _tag: "Failed"; readonly message: string }

export const TEMPLATE_WINDOW_TITLE = "Effect Desktop — basic-react-tailwind"

export function App() {
  const desktop = useDesktop()
  const currentWindow = useWindow()
  const [windowState, setWindowState] = useState<WindowState>({ _tag: "Idle" })

  const openWindow = () => {
    if (Option.isNone(desktop)) {
      setWindowState({ _tag: "Failed", message: "Desktop client unavailable." })
      return
    }

    setWindowState({ _tag: "Running" })

    void Effect.runPromiseExit(desktop.value.Window.create(windowRequest)).then((exit) => {
      if (Exit.isSuccess(exit)) {
        setWindowState({ _tag: "Succeeded", windowId: exit.value.id })
        return
      }
      setWindowState({ _tag: "Failed", message: String(exit.cause) })
    })
  }

  const canOpenWindow = Option.isSome(desktop) && windowState._tag !== "Running"
  const statusText = windowStatus(windowState, currentWindow)

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-zinc-950 dark:text-zinc-50">
      <section className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-normal text-emerald-700 dark:text-emerald-300">
          basic-react-tailwind
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight tracking-normal">
          Build a desktop renderer with React, Tailwind, and Effect.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-slate-700 dark:text-zinc-300">
          RPC contracts live in{" "}
          <code className="rounded bg-slate-100 px-1 dark:bg-zinc-800">src/contract.ts</code> as{" "}
          <code className="rounded bg-slate-100 px-1 dark:bg-zinc-800">Rpc.make</code> +{" "}
          <code className="rounded bg-slate-100 px-1 dark:bg-zinc-800">RpcGroup.make</code>. The
          host spine in{" "}
          <code className="rounded bg-slate-100 px-1 dark:bg-zinc-800">src/app.ts</code> wires{" "}
          <code className="rounded bg-slate-100 px-1 dark:bg-zinc-800">Desktop.app()</code> with the
          handler layer.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-700 px-5 text-sm font-semibold text-white motion-safe:transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-zinc-700"
            disabled={!canOpenWindow}
            type="button"
            onClick={openWindow}
          >
            Open window
          </button>
          <p className="text-sm text-slate-600 dark:text-zinc-400" data-template-status>
            {statusText}
          </p>
        </div>
      </section>
    </main>
  )
}

function windowStatus(
  state: WindowState,
  currentWindow: Option.Option<{ readonly id: string }>
): string {
  if (Option.isSome(currentWindow)) {
    return `Current window: ${currentWindow.value.id}`
  }

  switch (state._tag) {
    case "Idle":
      return "Desktop client ready."
    case "Running":
      return "Opening window..."
    case "Succeeded":
      return `Opened ${state.windowId}.`
    case "Failed":
      return state.message
  }
}
