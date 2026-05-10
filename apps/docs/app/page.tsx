import Link from "next/link"

const PRINCIPLES = [
  "Typed native capabilities",
  "Observable runtime lifecycle",
  "Structured failure handling",
  "Static renderer assets"
] as const

export default function HomePage() {
  return (
    <main className="min-h-screen bg-fd-background text-fd-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-between px-6 py-8 sm:px-8 lg:px-10">
        <nav className="flex items-center justify-between gap-4 border-b border-fd-border pb-5">
          <Link href="/" className="font-mono text-sm font-semibold uppercase tracking-wide">
            Effect Desktop
          </Link>
          <Link
            href="/docs"
            className="border border-fd-border px-3 py-2 font-mono text-xs font-medium uppercase text-fd-muted-foreground transition-colors hover:border-fd-foreground hover:text-fd-foreground"
          >
            Docs
          </Link>
        </nav>

        <div className="grid gap-10 py-14 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
          <div>
            <p className="mb-5 font-mono text-xs font-medium uppercase tracking-wide text-emerald-500">
              Effect-first desktop systems
            </p>
            <h1 className="max-w-4xl text-balance text-5xl font-semibold leading-[0.95] tracking-normal sm:text-7xl lg:text-8xl">
              Native power without hidden failure.
            </h1>
          </div>
          <div className="max-w-xl lg:justify-self-end">
            <p className="text-pretty text-lg leading-8 text-fd-muted-foreground">
              Effect Desktop turns windows, WebViews, native services, permissions, background
              jobs, and diagnostics into typed contracts that can be tested and operated.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/docs"
                className="bg-fd-foreground px-4 py-3 font-mono text-sm font-medium text-fd-background transition-opacity hover:opacity-90"
              >
                Read the docs
              </Link>
              <Link
                href="/docs/getting-started"
                className="border border-fd-border px-4 py-3 font-mono text-sm font-medium text-fd-foreground transition-colors hover:border-fd-foreground"
              >
                Start building
              </Link>
            </div>
          </div>
        </div>

        <div className="grid border-y border-fd-border md:grid-cols-4">
          {PRINCIPLES.map((principle) => (
            <div key={principle} className="border-fd-border py-5 md:border-r md:px-5 md:last:border-r-0">
              <p className="m-0 font-mono text-xs uppercase tracking-wide text-fd-muted-foreground">
                {principle}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

