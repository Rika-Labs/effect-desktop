import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./styles.css"

function App() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-8 py-12">
        <p className="mb-4 text-sm font-semibold uppercase tracking-normal text-emerald-300">
          app://localhost/
        </p>
        <h1 className="max-w-3xl text-5xl font-semibold leading-tight tracking-normal">
          Effect Desktop playground renderer
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-300" data-render-status>
          Vite, React, and Tailwind are running through the canonical renderer pipeline.
        </p>
      </section>
    </main>
  )
}

const root = document.querySelector("#root")

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

document.documentElement.dataset["renderer"] = "hydrated"
