import { expect, test } from "bun:test"
import { makeInspectorTransport } from "@effect-desktop/core/inspector-transport"
import { ReplayTransport, ReplayTransportFromSession } from "@effect-desktop/devtools/testing"
import { Effect } from "effect"

import {
  makeInspectorAppForTransports,
  recordedInspectorSession,
  summarizeCategories
} from "./inspector-app.js"

test("InspectorApp selects live sessions and categorizes transport events", async () => {
  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const live = yield* makeInspectorTransport({
        sessionId: "live-one",
        sessionLabel: "Observed app",
        now: () => 10
      })
      yield* live.publish({ source: "rpc.notes.load", payload: { method: "Notes.load" } })
      yield* live.publish({
        source: "resource.window",
        payload: { id: "main", state: "open" },
        timestampMs: 12
      })
      const replay = yield* Effect.service(ReplayTransport).pipe(
        Effect.provide(ReplayTransportFromSession(recordedInspectorSession))
      )
      const app = makeInspectorAppForTransports(live, replay)
      return yield* app.snapshot()
    })
  )

  expect(snapshot.selectedSessionId).toBe("live-one")
  expect(snapshot.sessions.map((session) => session.kind)).toEqual(["live", "recorded"])
  expect(snapshot.events.map((event) => event.category)).toEqual(["rpc", "resources"])
  expect(snapshot.categories.find((category) => category.id === "rpc")?.events).toBe(1)
})

test("InspectorApp replays recorded fixtures without a live observed app", async () => {
  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const live = yield* makeInspectorTransport({ sessionId: "live-empty", now: () => 10 })
      const replay = yield* Effect.service(ReplayTransport).pipe(
        Effect.provide(ReplayTransportFromSession(recordedInspectorSession))
      )
      const app = makeInspectorAppForTransports(live, replay)
      return yield* app.snapshot(recordedInspectorSession.id)
    })
  )

  expect(snapshot.selectedSessionId).toBe(recordedInspectorSession.id)
  expect(snapshot.events).toHaveLength(1)
  expect(snapshot.events[0]?.surface).toBe("diagnostics")
  expect(snapshot.categories.find((category) => category.id === "timeline")?.events).toBe(1)
})

test("summarizeCategories returns stable empty categories", () => {
  expect(summarizeCategories([])).toEqual([
    { id: "timeline", label: "Timeline", events: 0 },
    { id: "layers", label: "Layers", events: 0 },
    { id: "rpc", label: "RPC", events: 0 },
    { id: "resources", label: "Resources", events: 0 },
    { id: "security", label: "Security", events: 0 }
  ])
})
