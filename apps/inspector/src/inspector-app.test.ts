import { expect, test } from "bun:test"
import { makeInspectorTransport } from "@orika/core/inspector-transport"
import { makeReplayTransport } from "@orika/devtools/testing"
import { Effect } from "effect"

import {
  makeInspectorAppForTransports,
  recordedInspectorSession,
  summarizeCategories
} from "./inspector-app.js"

test("InspectorApp selects live sessions and categorizes transport events", () =>
  Effect.runPromise(
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
      const replay = makeReplayTransport(recordedInspectorSession)
      const app = makeInspectorAppForTransports(live, replay)
      return yield* app.snapshot()
    })
  ).then((snapshot) => {
    expect(snapshot.selectedSessionId).toBe("live-one")
    expect(snapshot.sessions.map((session) => session.kind)).toEqual(["live", "recorded"])
    expect(snapshot.events.map((event) => event.category)).toEqual(["rpc", "resources"])
    expect(snapshot.categories.find((category) => category.id === "rpc")?.events).toBe(1)
  }))

test("InspectorApp replays recorded fixtures without a live observed app", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const live = yield* makeInspectorTransport({ sessionId: "live-empty", now: () => 10 })
      const replay = makeReplayTransport(recordedInspectorSession)
      const app = makeInspectorAppForTransports(live, replay)
      return yield* app.snapshot(recordedInspectorSession.id)
    })
  ).then((snapshot) => {
    expect(snapshot.selectedSessionId).toBe(recordedInspectorSession.id)
    expect(snapshot.events).toHaveLength(1)
    expect(snapshot.events[0]?.surface).toBe("diagnostics")
    expect(snapshot.categories.find((category) => category.id === "timeline")?.events).toBe(1)
  }))

test("InspectorApp normalizes unknown selected sessions to the live session", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const live = yield* makeInspectorTransport({
        sessionId: "live-one",
        sessionLabel: "Observed app",
        now: () => 10
      })
      yield* live.publish({ source: "rpc.notes.load", payload: { method: "Notes.load" } })
      const replay = makeReplayTransport(recordedInspectorSession)
      const app = makeInspectorAppForTransports(live, replay)
      return yield* app.snapshot("missing-session")
    })
  ).then((snapshot) => {
    expect(snapshot.selectedSessionId).toBe("live-one")
    expect(snapshot.sessions.map((session) => session.id)).toContain(snapshot.selectedSessionId)
    expect(snapshot.events.map((event) => event.category)).toEqual(["rpc"])
  }))

test("summarizeCategories returns stable empty categories", () => {
  expect(summarizeCategories([])).toEqual([
    { id: "timeline", label: "Timeline", events: 0 },
    { id: "layers", label: "Layers", events: 0 },
    { id: "rpc", label: "RPC", events: 0 },
    { id: "resources", label: "Resources", events: 0 },
    { id: "security", label: "Security", events: 0 }
  ])
})
