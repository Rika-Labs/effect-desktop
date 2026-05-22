import { makeInspectorTransport } from "@orika/core/inspector-transport"
import { makeReplayTransport } from "@orika/devtools/testing"
import { Cause, Effect, Exit } from "effect"
import { StrictMode, useState } from "react"

import { App } from "./App.js"
import {
  makeInspectorAppForTransports,
  recordedInspectorSession,
  type InspectorAppSnapshot
} from "./inspector-app.js"
import { getOrCreateInspectorRoot } from "./react-root-registry.js"
import "./styles.css"

const root = typeof document === "undefined" ? null : document.querySelector("#root")

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
  const replay = makeReplayTransport(recordedInspectorSession)
  const service = makeInspectorAppForTransports(live, replay, {
    liveLabel: "Sample observed app"
  })
  const snapshot = yield* service.snapshot()
  return { service, snapshot }
})

if (root !== null) {
  const inspectorRoot = getOrCreateInspectorRoot(root)
  void Effect.runCallback(boot, {
    onExit: (exit) => {
      inspectorRoot.render(
        <StrictMode>
          {Exit.isSuccess(exit) ? (
            <InspectorRoot service={exit.value.service} initialSnapshot={exit.value.snapshot} />
          ) : (
            <InspectorError error={Cause.squash(exit.cause)} />
          )}
        </StrictMode>
      )
    }
  })
}

interface InspectorRootProps {
  readonly service: ReturnType<typeof makeInspectorAppForTransports>
  readonly initialSnapshot: InspectorAppSnapshot
}

function InspectorRoot({ initialSnapshot, service }: InspectorRootProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [snapshotError, setSnapshotError] = useState<unknown>()

  const selectSession = (sessionId: string): void => {
    void Effect.runCallback(service.snapshot(sessionId), {
      onExit: (exit) => {
        if (Exit.isSuccess(exit)) {
          setSnapshot(exit.value)
          setSnapshotError(undefined)
        } else {
          setSnapshotError(Cause.squash(exit.cause))
        }
      }
    })
  }

  return (
    <>
      {snapshotError === undefined ? null : <InspectorError error={snapshotError} />}
      <App snapshot={snapshot} onSelectSession={selectSession} />
    </>
  )
}

interface InspectorErrorProps {
  readonly error: unknown
}

function InspectorError({ error }: InspectorErrorProps) {
  return (
    <div className="inspector-error" role="alert">
      <strong>Inspector error</strong>
      <span>{formatInspectorError(error)}</span>
    </div>
  )
}

const formatInspectorError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
