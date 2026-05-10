import { useOptionalDesktopClient } from "@effect-desktop/react"
import { Option } from "effect"

import { multiWindowTemplateMessages as copy } from "./messages.js"

export function App() {
  const desktop = useOptionalDesktopClient()

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-zinc-950 dark:text-zinc-50">
      <section className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-normal text-amber-600 dark:text-amber-400">
          {copy.eyebrow}
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight tracking-normal">
          {copy.title}
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-slate-700 dark:text-zinc-300">
          {copy.descriptionStart}
          <code className="rounded bg-slate-100 px-1 dark:bg-zinc-800">
            effect/unstable/cluster
          </code>
          {copy.descriptionEnd}
        </p>
        <p className="mt-3 text-sm text-slate-500 dark:text-zinc-500">
          {copy.desktopClient} {Option.isSome(desktop) ? copy.connected : copy.unavailable}
        </p>
      </section>
    </main>
  )
}
