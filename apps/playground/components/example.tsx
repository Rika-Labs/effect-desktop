"use client"

import { useCallback, useState, type ReactNode } from "react"

type RunState = "idle" | "running" | "complete" | "interrupted"

type Accent = "emerald" | "amber" | "blue" | "slate"

const ACCENT: Readonly<
  Record<
    Accent,
    {
      readonly dot: string
      readonly chip: string
      readonly bar: string
    }
  >
> = {
  emerald: {
    dot: "bg-emerald-400",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    bar: "bg-emerald-500"
  },
  amber: {
    dot: "bg-amber-400",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    bar: "bg-amber-500"
  },
  blue: {
    dot: "bg-blue-400",
    chip: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    bar: "bg-blue-500"
  },
  slate: {
    dot: "bg-slate-400",
    chip: "border-slate-500/30 bg-slate-500/10 text-slate-300",
    bar: "bg-slate-500"
  }
}

const STATE_LABEL: Readonly<Record<RunState, string>> = {
  idle: "idle",
  running: "running",
  complete: "complete",
  interrupted: "interrupted"
}

export type ExampleProps = {
  readonly title: string
  readonly summary?: string
  readonly accent?: Accent
  readonly successOutput: string
  readonly interruptedOutput?: string
  readonly children: ReactNode
}

export function Example({
  title,
  summary,
  accent = "emerald",
  successOutput,
  interruptedOutput = "interrupted · finalizers ran",
  children
}: ExampleProps) {
  const [state, setState] = useState<RunState>("idle")
  const tone = ACCENT[accent]

  const onRun = useCallback(() => {
    setState("running")
    const id = setTimeout(() => {
      setState((current) => (current === "running" ? "complete" : current))
    }, 520)
    return () => clearTimeout(id)
  }, [])

  const onInterrupt = useCallback(() => {
    setState("interrupted")
  }, [])

  const onReset = useCallback(() => {
    setState("idle")
  }, [])

  const output =
    state === "complete"
      ? successOutput
      : state === "interrupted"
        ? interruptedOutput
        : state === "running"
          ? "…"
          : "—"

  return (
    <figure className="not-prose my-6 overflow-hidden border border-fd-border bg-fd-card">
      <figcaption className="flex items-start justify-between gap-3 border-b border-fd-border px-4 py-3">
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-2 text-sm font-medium text-fd-foreground">
            <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} />
            {title}
          </p>
          {summary ? <p className="m-0 mt-1 text-xs text-fd-muted-foreground">{summary}</p> : null}
        </div>
        <span
          className={`shrink-0 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
            state === "complete"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : state === "interrupted"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : state === "running"
                  ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
                  : "border-fd-border bg-fd-muted text-fd-muted-foreground"
          }`}
        >
          {STATE_LABEL[state]}
        </span>
      </figcaption>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] md:items-stretch">
        <div className="border-fd-border md:border-r [&_pre]:m-0 [&_pre]:rounded-none [&_pre]:border-0">
          {children}
        </div>
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRun}
              disabled={state === "running"}
              className="inline-flex h-8 items-center gap-1.5 border border-emerald-500/40 bg-emerald-500 px-3 font-mono text-xs font-medium text-black transition-colors hover:bg-emerald-400 disabled:opacity-60"
            >
              <PlayIcon /> Run
            </button>
            <button
              type="button"
              onClick={onInterrupt}
              disabled={state !== "running"}
              className="inline-flex h-8 items-center gap-1.5 border border-fd-border bg-fd-muted px-3 font-mono text-xs font-medium text-fd-foreground transition-colors hover:bg-fd-accent disabled:opacity-50"
            >
              <SquareIcon /> Interrupt
            </button>
            <button
              type="button"
              onClick={onReset}
              disabled={state === "idle"}
              className="inline-flex h-8 items-center gap-1.5 border border-transparent bg-transparent px-3 font-mono text-xs font-medium text-fd-muted-foreground transition-colors hover:text-fd-foreground disabled:opacity-50"
            >
              <RotateIcon /> Reset
            </button>
          </div>
          <div className="min-w-[12rem]">
            <p className="m-0 text-[10px] font-medium uppercase tracking-wide text-fd-muted-foreground">
              Output
            </p>
            <p className="m-0 mt-1 break-words font-mono text-sm text-fd-foreground">{output}</p>
          </div>
        </div>
      </div>

      <div className="relative h-px overflow-hidden bg-fd-border">
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 transition-[width] duration-500 ${tone.bar} ${
            state === "running"
              ? "w-1/2 animate-pulse"
              : state === "complete"
                ? "w-full"
                : state === "interrupted"
                  ? "w-1/3"
                  : "w-0"
          }`}
        />
      </div>
    </figure>
  )
}

function PlayIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <polygon points="2,1 9,5 2,9" fill="currentColor" />
    </svg>
  )
}

function SquareIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <rect x="2" y="2" width="6" height="6" fill="currentColor" />
    </svg>
  )
}

function RotateIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
      <path
        d="M2.5 5.5a3 3 0 1 1 .9 2.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M2.2 3.4v2.4h2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
