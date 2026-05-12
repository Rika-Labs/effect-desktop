import type { WindowCreateOptions } from "@effect-desktop/native/contracts"
import { useWindow, windows } from "@effect-desktop/react"
import { Option } from "effect"

import { DEFAULT_TEMPLATE_LOCALE, resolveTemplateLocale, type TemplateLocale } from "./messages.js"

const defaultLocale = resolveTemplateLocale("en")

const windowRequest: WindowCreateOptions = Object.freeze({
  title: defaultLocale.copy.windowTitle,
  width: 960,
  height: 640
})

export const TEMPLATE_WINDOW_TITLE = defaultLocale.copy.windowTitle

export interface AppProps {
  readonly locale?: TemplateLocale
}

export function App(props: AppProps = {}) {
  const selectedLocale = resolveTemplateLocale(props.locale ?? DEFAULT_TEMPLATE_LOCALE)
  const copy = selectedLocale.copy
  const currentWindow = useWindow()
  const createWindow = windows.create.useMutation()

  const canOpenWindow = !createWindow.isRunning
  const statusText = (() => {
    if (Option.isSome(currentWindow)) {
      return copy.currentWindow(currentWindow.value.id)
    }

    switch (createWindow.state.status) {
      case "idle":
        return copy.ready
      case "running":
        return copy.running
      case "success":
        return copy.opened(createWindow.state.value.id)
      case "failure":
        return "Could not open window."
    }
  })()

  return (
    <main
      className="min-h-screen bg-slate-50 text-slate-950 dark:bg-zinc-950 dark:text-zinc-50"
      dir={selectedLocale.direction}
      lang={selectedLocale.locale}
    >
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
            onClick={() => {
              createWindow.run(windowRequest)
            }}
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
