import type { WindowCreateOptions } from "@effect-desktop/native"
import { useDesktop, useWindow } from "@effect-desktop/react"
import { Effect, Exit, Option } from "effect"
import { useMemo, useState } from "react"

export const TEMPLATE_WINDOW_TITLE = "Effect Desktop template window"

const windowRequest: WindowCreateOptions = Object.freeze({
  title: TEMPLATE_WINDOW_TITLE,
  width: 960,
  height: 640
})

type CallState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Unavailable" }
  | { readonly _tag: "Running" }
  | { readonly _tag: "Succeeded"; readonly windowId: string }
  | { readonly _tag: "Failed"; readonly message: string }

export function App() {
  const desktop = useDesktop()
  const currentWindow = useWindow()
  const [callState, setCallState] = useState<CallState>({ _tag: "Idle" })
  const canCallDesktop = Option.isSome(desktop)
  const status = useMemo(() => statusText(callState), [callState])
  const windowStatus = Option.isSome(currentWindow) ? `Current ${currentWindow.value.id}.` : status

  const openWindow = () => {
    if (Option.isNone(desktop)) {
      setCallState({ _tag: "Unavailable" })
      return
    }

    setCallState({ _tag: "Running" })
    void Effect.runPromiseExit(desktop.value.Window.create(windowRequest)).then((exit) => {
      if (Exit.isSuccess(exit)) {
        setCallState({ _tag: "Succeeded", windowId: exit.value.id })
        return
      }

      setCallState({ _tag: "Failed", message: String(exit.cause) })
    })
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-zinc-950 dark:text-zinc-50">
      <section className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-normal text-emerald-700 dark:text-emerald-300">
          basic-react-tailwind
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight tracking-normal">
          Build a desktop renderer with React, Tailwind, and typed Effects.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-slate-700 dark:text-zinc-300">
          This template uses public Effect Desktop hooks and keeps native calls as explicit Effect
          values, so failures stay observable instead of being thrown from the render path.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-600 px-5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-zinc-700"
            disabled={!canCallDesktop || callState._tag === "Running"}
            type="button"
            onClick={openWindow}
          >
            Open window
          </button>
          <p className="text-sm text-slate-600 dark:text-zinc-400" data-template-status>
            {windowStatus}
          </p>
        </div>
      </section>
    </main>
  )
}

function statusText(state: CallState): string {
  switch (state._tag) {
    case "Idle":
      return "Desktop client ready."
    case "Unavailable":
      return "Desktop client unavailable."
    case "Running":
      return "Opening window..."
    case "Succeeded":
      return `Opened ${state.windowId}.`
    case "Failed":
      return state.message
  }
}
