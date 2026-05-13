import { makeInspectorTransport } from "@effect-desktop/core/inspector-transport"
import { ReplayTransport, ReplayTransportFromSession } from "@effect-desktop/devtools/testing"
import { Effect } from "effect"
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App.js"
import {
  makeInspectorAppForTransports,
  recordedInspectorSession,
  type InspectorAppSnapshot
} from "./inspector-app.js"
import "./styles.css"

const root = document.querySelector("#root")

const boot = Effect.gen(function* () {
  const live = yield* makeInspectorTransport({
    sessionId: "sample-live-session",
    sessionLabel: "Sample observed app",
    now: () => 1_700_000_000_000
  })
  yield* live.publish({
    source: "rpc.notes.load",
    payload: { method: "Notes.load", durationMs: 12 }
  })
  yield* live.publish({
    source: "resource.window",
    payload: { id: "main", state: "open" },
    timestampMs: 1_700_000_000_016
  })
  yield* live.publish({
    source: "layer.runtime",
    payload: { provider: "DesktopRuntimeLive", status: "ready" },
    timestampMs: 1_700_000_000_032
  })
  const replay = yield* Effect.service(ReplayTransport).pipe(
    Effect.provide(ReplayTransportFromSession(recordedInspectorSession))
  )
  const service = makeInspectorAppForTransports(live, replay, {
    liveLabel: "Sample observed app"
  })
  const snapshot = yield* service.snapshot()
  return { service, snapshot }
})

if (root !== null) {
  void Effect.runPromise(boot).then(({ service, snapshot }) => {
    createRoot(root).render(
      <StrictMode>
        <InspectorRoot service={service} initialSnapshot={snapshot} />
      </StrictMode>
    )
  })
}

interface InspectorRootProps {
  readonly service: ReturnType<typeof makeInspectorAppForTransports>
  readonly initialSnapshot: InspectorAppSnapshot
}

function InspectorRoot({ initialSnapshot, service }: InspectorRootProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot)

  const selectSession = (sessionId: string): void => {
    void Effect.runPromise(service.snapshot(sessionId)).then(setSnapshot)
  }

  return <App snapshot={snapshot} onSelectSession={selectSession} />
}
