import { Context, Effect, Layer, Schedule, Stream } from "effect"
import { EventJournal, EventLog as EventLogNS } from "effect/unstable/eventlog"

import { positiveFrameInterval, positiveRowLimit } from "./panel-options.js"

export interface EventLogPanelRow {
  readonly id: string
  readonly event: string
  readonly primaryKey: string
  readonly payloadBytes: number
  readonly timestampMs: number
}

export interface EventLogPanelSnapshot {
  readonly entries: readonly EventLogPanelRow[]
  readonly totalCount: number
}

export type EventLogPanelError = EventJournal.EventJournalError

export interface EventLogPanelApi {
  readonly list: () => Effect.Effect<EventLogPanelSnapshot, EventLogPanelError, never>
  readonly observe: () => Stream.Stream<EventLogPanelSnapshot, EventLogPanelError, never>
}

export interface EventLogPanelOptions {
  readonly maxRows?: number
  readonly frameInterval?: `${number} millis`
}

export class EventLogPanel extends Context.Service<EventLogPanel, EventLogPanelApi>()(
  "@effect-desktop/devtools/event-log-panel/EventLogPanel"
) {}

export const EventLogPanelLive = (
  options: EventLogPanelOptions = {}
): Layer.Layer<EventLogPanel, never, EventLogNS.EventLog> =>
  Layer.effect(EventLogPanel)(makeEventLogPanel(options))

export const makeEventLogPanel = (
  options: EventLogPanelOptions = {}
): Effect.Effect<EventLogPanelApi, never, EventLogNS.EventLog> =>
  Effect.gen(function* () {
    const eventLog = yield* EventLogNS.EventLog
    const maxRows = positiveRowLimit(options.maxRows, 256)
    const frameInterval = positiveFrameInterval(options.frameInterval, "16 millis")

    const list = (): Effect.Effect<EventLogPanelSnapshot, EventLogPanelError, never> =>
      eventLog.entries.pipe(
        Effect.map((entries: ReadonlyArray<EventJournal.Entry>) => {
          const total = entries.length
          const visible = entries.slice(-maxRows)
          return {
            entries: visible.map(toRow),
            totalCount: total
          } satisfies EventLogPanelSnapshot
        })
      )

    return Object.freeze({
      list,
      observe: () => Stream.fromEffectSchedule(list(), Schedule.spaced(frameInterval))
    } satisfies EventLogPanelApi)
  })

const toRow = (entry: EventJournal.Entry): EventLogPanelRow => ({
  id: entry.idString,
  event: entry.event,
  primaryKey: entry.primaryKey,
  payloadBytes: entry.payload.byteLength,
  timestampMs: EventJournal.entryIdMillis(entry.id)
})
