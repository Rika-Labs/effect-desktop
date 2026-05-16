import {
  InspectorTransport,
  type InspectorTransportApi,
  type InspectorTransportEvent,
  type InspectorTransportInvalidArgumentError
} from "@effect-desktop/core/inspector-transport"
import {
  type InspectorSurface,
  type RecordedInspectorFrame,
  recordedDiagnosticsSession,
  ReplayTransport,
  type ReplayTransportApi
} from "@effect-desktop/devtools/testing"
import { Context, Effect, Layer, Schedule, Stream } from "effect"

export type InspectorSessionKind = "live" | "recorded"

export interface InspectorSessionRow {
  readonly id: string
  readonly label: string
  readonly kind: InspectorSessionKind
  readonly startedAt: number
  readonly events: number
}

export interface InspectorTimelineEvent {
  readonly id: string
  readonly atMs: number
  readonly surface: InspectorSurface | "transport"
  readonly title: string
  readonly detail: string
  readonly category: "timeline" | "layers" | "rpc" | "resources" | "security"
}

export interface InspectorAppSnapshot {
  readonly selectedSessionId: string
  readonly sessions: readonly InspectorSessionRow[]
  readonly events: readonly InspectorTimelineEvent[]
  readonly categories: readonly InspectorTimelineCategory[]
}

export interface InspectorTimelineCategory {
  readonly id: InspectorTimelineEvent["category"]
  readonly label: string
  readonly events: number
}

export interface InspectorAppApi {
  readonly snapshot: (
    selectedSessionId?: string
  ) => Effect.Effect<InspectorAppSnapshot, InspectorTransportInvalidArgumentError, never>
  readonly observe: (
    selectedSessionId?: string
  ) => Stream.Stream<InspectorAppSnapshot, InspectorTransportInvalidArgumentError, never>
}

export interface InspectorAppOptions {
  readonly liveLabel?: string
}

export class InspectorApp extends Context.Service<InspectorApp, InspectorAppApi>()(
  "@effect-desktop/inspector/InspectorApp"
) {}

export const InspectorAppLive = (
  options: InspectorAppOptions = {}
): Layer.Layer<InspectorApp, never, InspectorTransport | ReplayTransport> =>
  Layer.effect(InspectorApp)(makeInspectorApp(options))

export const makeInspectorApp = (
  options: InspectorAppOptions = {}
): Effect.Effect<InspectorAppApi, never, InspectorTransport | ReplayTransport> =>
  Effect.gen(function* () {
    const live = yield* InspectorTransport
    const replay = yield* ReplayTransport

    return makeInspectorAppForTransports(live, replay, options)
  })

export const makeInspectorAppForTransports = (
  live: InspectorTransportApi,
  replay: ReplayTransportApi,
  options: InspectorAppOptions = {}
): InspectorAppApi => {
  const snapshot = (
    selectedSessionId?: string
  ): Effect.Effect<InspectorAppSnapshot, InspectorTransportInvalidArgumentError, never> =>
    Effect.gen(function* () {
      const [liveState, recordedSession] = yield* Effect.all([live.snapshot(), replay.session()])
      const liveEvents = yield* live.replay()
      const selectedId = selectedSessionId ?? liveState.session.sessionId
      const recordedEvents = framesToTimeline(recordedSession.frames)
      const liveTimeline = transportEventsToTimeline(liveEvents)
      const sessions: readonly InspectorSessionRow[] = [
        {
          id: liveState.session.sessionId,
          label: options.liveLabel ?? liveState.session.label ?? "Live app",
          kind: "live",
          startedAt: liveState.session.startedAt,
          events: liveState.retainedEvents
        },
        {
          id: recordedSession.id,
          label: "Recorded fixture",
          kind: "recorded",
          startedAt: recordedSession.startedAt,
          events: recordedSession.frames.length
        }
      ]
      const events = selectedId === recordedSession.id ? recordedEvents : liveTimeline
      return {
        selectedSessionId: selectedId,
        sessions,
        events,
        categories: summarizeCategories(events)
      } satisfies InspectorAppSnapshot
    })

  return Object.freeze({
    snapshot,
    observe: (selectedSessionId) =>
      Stream.fromEffectSchedule(snapshot(selectedSessionId), Schedule.spaced("250 millis"))
  } satisfies InspectorAppApi)
}

export const recordedInspectorSession = recordedDiagnosticsSession

export const transportEventsToTimeline = (
  events: readonly InspectorTransportEvent[]
): readonly InspectorTimelineEvent[] =>
  events.map((event) => ({
    id: `live-${event.sequence}`,
    atMs: event.timestampMs,
    surface: "transport",
    title: event.source,
    detail: describePayload(event.payload),
    category: categoryForSource(event.source)
  }))

export const framesToTimeline = (
  frames: readonly RecordedInspectorFrame[]
): readonly InspectorTimelineEvent[] =>
  frames.map((frame, index) => ({
    id: `recorded-${index}`,
    atMs: frame.atMs,
    surface: frame.surface,
    title: surfaceTitle(frame.surface),
    detail: describePayload(frame.payload),
    category: categoryForSource(frame.surface)
  }))

export const summarizeCategories = (
  events: readonly InspectorTimelineEvent[]
): readonly InspectorTimelineCategory[] => {
  const counts = new Map<InspectorTimelineEvent["category"], number>()
  for (const event of events) {
    counts.set(event.category, (counts.get(event.category) ?? 0) + 1)
  }
  return CATEGORY_ORDER.map((id) => ({
    id,
    label: CATEGORY_LABELS[id],
    events: counts.get(id) ?? 0
  }))
}

const CATEGORY_ORDER: readonly InspectorTimelineEvent["category"][] = [
  "timeline",
  "layers",
  "rpc",
  "resources",
  "security"
]

const CATEGORY_LABELS: Record<InspectorTimelineEvent["category"], string> = {
  timeline: "Timeline",
  layers: "Layers",
  rpc: "RPC",
  resources: "Resources",
  security: "Security"
}

const categoryForSource = (source: string): InspectorTimelineEvent["category"] => {
  const normalized = source.toLowerCase()
  if (normalized.includes("layer")) {
    return "layers"
  }
  if (normalized.includes("rpc") || normalized.includes("bridge")) {
    return "rpc"
  }
  if (
    normalized.includes("resource") ||
    normalized.includes("worker") ||
    normalized.includes("process")
  ) {
    return "resources"
  }
  if (
    normalized.includes("security") ||
    normalized.includes("permission") ||
    normalized.includes("audit")
  ) {
    return "security"
  }
  return "timeline"
}

const surfaceTitle = (surface: InspectorSurface): string => {
  switch (surface) {
    case "liveRuntime":
      return "Live runtime"
    case "eventLog":
      return "Event log"
    case "cluster":
    case "commands":
    case "diagnostics":
    case "logs":
    case "performance":
    case "persistence":
    case "reactivity":
    case "workers":
    case "workflows":
      return surface
    default:
      return surface
  }
}

const describePayload = (payload: unknown): string => {
  if (typeof payload === "string") {
    return payload
  }
  if (typeof payload === "number" || typeof payload === "boolean") {
    return String(payload)
  }
  if (payload === null || payload === undefined) {
    return "No payload"
  }
  if (Array.isArray(payload)) {
    return `${payload.length} item${payload.length === 1 ? "" : "s"}`
  }
  if (typeof payload === "object") {
    return Object.keys(payload).slice(0, 4).join(", ")
  }
  return "Unknown payload"
}
