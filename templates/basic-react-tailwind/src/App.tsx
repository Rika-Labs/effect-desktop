import type { WindowCreateOptions } from "@effect-desktop/native"
import { useDesktop, useWindow } from "@effect-desktop/react"
import { Effect, Exit, Option } from "effect"
import { useState } from "react"

import { templateMessages } from "./messages.js"

const copy = templateMessages.en

const windowRequest: WindowCreateOptions = Object.freeze({
  title: copy.windowTitle,
  width: 960,
  height: 640
})

type WindowState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Running" }
  | { readonly _tag: "Succeeded"; readonly windowId: string }
  | { readonly _tag: "Failed"; readonly message: string }

export const TEMPLATE_WINDOW_TITLE = copy.windowTitle

export function App() {
  const desktop = useDesktop()
  const currentWindow = useWindow()
  const [windowState, setWindowState] = useState<WindowState>({ _tag: "Idle" })

  const openWindow = () => {
    if (Option.isNone(desktop)) {
      setWindowState({ _tag: "Failed", message: copy.unavailable })
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
          {copy.eyebrow}
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight tracking-normal">
          {copy.title}
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-slate-700 dark:text-zinc-300">
          {copy.description}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-700 px-5 text-sm font-semibold text-white motion-safe:transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-zinc-700"
            disabled={!canOpenWindow}
            type="button"
            onClick={openWindow}
          >
            {copy.openWindow}
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
    return copy.currentWindow(currentWindow.value.id)
  }

  switch (state._tag) {
    case "Idle":
      return copy.ready
    case "Running":
      return copy.running
    case "Succeeded":
      return copy.opened(state.windowId)
    case "Failed":
      return state.message
  }
}
