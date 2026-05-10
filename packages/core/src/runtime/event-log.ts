import type { Layer } from "effect"
import { EventJournal, SqlEventJournal } from "effect/unstable/eventlog"

export {
  Event,
  EventGroup,
  EventJournal,
  EventLog,
  SqlEventJournal
} from "effect/unstable/eventlog"

export interface DurableEventJournalOptions {
  readonly entryTable?: string
  readonly remotesTable?: string
}

export const EventJournalMemoryLive: Layer.Layer<EventJournal.EventJournal> =
  EventJournal.layerMemory

export const EventJournalSqlLive = (
  options: DurableEventJournalOptions = {}
): ReturnType<typeof SqlEventJournal.layer> => SqlEventJournal.layer(options)
