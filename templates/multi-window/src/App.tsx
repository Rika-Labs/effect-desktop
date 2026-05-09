import { useDesktop } from "@effect-desktop/react"
import { Option } from "effect"

export function App() {
  const desktop = useDesktop()

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-zinc-950 dark:text-zinc-50">
      <section className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-normal text-amber-600 dark:text-amber-400">
          multi-window — stub
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight tracking-normal">
          Multi-window cluster coordination
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-slate-700 dark:text-zinc-300">
          This template depends on T29 (
          <code className="rounded bg-slate-100 px-1 dark:bg-zinc-800">
            effect/unstable/cluster
          </code>
          ), which is currently in R&amp;D prototype status. The contract and spine are wired;
          cluster entity coordination will be added when T29 reaches a go verdict.
        </p>
        <p className="mt-3 text-sm text-slate-500 dark:text-zinc-500">
          Desktop client: {Option.isSome(desktop) ? "connected" : "unavailable"}
        </p>
      </section>
    </main>
  )
}
