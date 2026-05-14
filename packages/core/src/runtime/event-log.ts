import type { RedactionFilterOptions } from "@effect-desktop/bridge"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { EventGroup, EventJournal, EventLog, EventLogEncryption } from "effect/unstable/eventlog"

import {
  EventLogInspectorCollector,
  EventLogInspectorEvent,
  disabledEventLogInspectorCollector
} from "./inspector-events.js"
import {
  makeInspectorSafetyPolicy,
  type InspectorSafetyPolicyApi
} from "./inspector-safety-policy.js"

const NonEmptyString = Schema.NonEmptyString
const NonNegativeNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))

export const DesktopEventLogEventKind = Schema.Literals([
  "append",
  "query",
  "recovery",
  "read-only-transition"
])
export type DesktopEventLogEventKind = typeof DesktopEventLogEventKind.Type

export class DesktopEventLogEvent extends Schema.Class<DesktopEventLogEvent>(
  "DesktopEventLogEvent"
)({
  kind: DesktopEventLogEventKind,
  status: Schema.Literals(["start", "success", "failure", "interruption", "cleanup"]),
  operation: NonEmptyString,
  event: Schema.optionalKey(Schema.String),
  primaryKey: Schema.optionalKey(Schema.String),
  entryId: Schema.optionalKey(Schema.String),
  payloadBytes: Schema.optionalKey(NonNegativeNumber),
  traceId: Schema.optionalKey(Schema.String),
  namespace: Schema.optionalKey(Schema.String),
  errorTag: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
  timestamp: NonNegativeNumber
}) {}

export interface DesktopEventLogQuery {
  readonly kind?: DesktopEventLogEventKind
  readonly primaryKey?: string
  readonly namespace?: string
  readonly limit?: number
}

export interface DesktopEventLogRecord {
  readonly entryId: string
  readonly event: string
  readonly primaryKey: string
  readonly payload: DesktopEventLogEvent
}

export interface DesktopEventLogPolicyOptions {
  readonly maxQueryEntries?: number
  readonly redaction?: RedactionFilterOptions
  readonly inspectorSafety?: InspectorSafetyPolicyApi
}

export interface DesktopEventLogApi {
  readonly append: (
    event: DesktopEventLogEvent
  ) => Effect.Effect<void, EventJournal.EventJournalError, never>
  readonly query: (
    query?: DesktopEventLogQuery
  ) => Effect.Effect<readonly DesktopEventLogRecord[], EventJournal.EventJournalError, never>
  readonly destroy: Effect.Effect<void, EventJournal.EventJournalError, never>
}

const defaultMaxQueryEntries = 500
const desktopEventLogTag = "desktop-event-log"

const primaryKey = (event: DesktopEventLogEvent): string =>
  event.traceId ?? event.entryId ?? event.primaryKey ?? event.operation

export const DesktopEventLogGroup = EventGroup.empty.add({
  tag: desktopEventLogTag,
  primaryKey,
  payload: DesktopEventLogEvent
})

export const DesktopEventSchema = EventLog.schema(DesktopEventLogGroup)

export const DesktopEventLogHandlersLive = EventLog.group(DesktopEventLogGroup, (handlers) =>
  handlers.handle(desktopEventLogTag, () => Effect.void)
)

export class DesktopEventLog extends Context.Service<DesktopEventLog, DesktopEventLogApi>()(
  "DesktopEventLog"
) {}

export const makeDesktopEventLog = (
  log: EventLog.EventLog["Service"],
  inspector: EventLogInspectorCollector["Service"] = disabledEventLogInspectorCollector,
  options: DesktopEventLogPolicyOptions = {}
): Effect.Effect<DesktopEventLogApi, never, never> =>
  Effect.gen(function* () {
    const inspectorSafety =
      options.inspectorSafety ??
      (yield* makeInspectorSafetyPolicy(
        options.redaction === undefined ? {} : { redaction: options.redaction }
      ).pipe(Effect.orDie))

    const sanitize = (
      event: DesktopEventLogEvent
    ): Effect.Effect<DesktopEventLogEvent | undefined> =>
      inspectorSafety
        .sanitize({
          source: "desktop.event-log",
          payload: event
        })
        .pipe(
          Effect.flatMap((decision) =>
            Option.isNone(decision.value)
              ? Effect.succeed(undefined)
              : Schema.decodeUnknownEffect(DesktopEventLogEvent)(decision.value.value).pipe(
                  Effect.orDie
                )
          )
        )

    const publishInspector = (event: DesktopEventLogEvent): Effect.Effect<void> =>
      inspector
        .publish(
          new EventLogInspectorEvent({
            kind: event.kind,
            status: event.status,
            operation: event.operation,
            ...(event.event === undefined ? {} : { event: event.event }),
            ...(event.primaryKey === undefined ? {} : { primaryKey: event.primaryKey }),
            ...(event.entryId === undefined ? {} : { entryId: event.entryId }),
            ...(event.payloadBytes === undefined ? {} : { payloadBytes: event.payloadBytes }),
            ...(event.traceId === undefined ? {} : { traceId: event.traceId }),
            ...(event.namespace === undefined ? {} : { namespace: event.namespace }),
            ...(event.errorTag === undefined ? {} : { errorTag: event.errorTag }),
            ...(event.message === undefined ? {} : { message: event.message }),
            timestamp: event.timestamp
          })
        )
        .pipe(Effect.ignore)

    const append = (
      event: DesktopEventLogEvent
    ): Effect.Effect<void, EventJournal.EventJournalError, never> =>
      Effect.gen(function* () {
        const sanitized = yield* sanitize(event)
        if (sanitized === undefined) {
          return
        }
        yield* log.write({
          schema: DesktopEventSchema,
          event: desktopEventLogTag,
          payload: sanitized
        })
        yield* publishInspector(sanitized)
      }).pipe(
        Effect.catch((error: EventJournal.EventJournalError) =>
          publishInspector(
            new DesktopEventLogEvent({
              kind: "append",
              status: "failure",
              operation: event.operation,
              ...(event.event === undefined ? {} : { event: event.event }),
              ...(event.primaryKey === undefined ? {} : { primaryKey: event.primaryKey }),
              ...(event.traceId === undefined ? {} : { traceId: event.traceId }),
              errorTag: error._tag,
              message: `${error.method} failed`,
              timestamp: event.timestamp
            })
          ).pipe(Effect.andThen(Effect.fail(error)))
        )
      )

    const query = (
      queryOptions: DesktopEventLogQuery = {}
    ): Effect.Effect<readonly DesktopEventLogRecord[], EventJournal.EventJournalError, never> =>
      log.entries.pipe(
        Effect.flatMap((entries) =>
          applyQueryPolicy(entries, queryOptions, options.maxQueryEntries)
        ),
        Effect.tap(() =>
          publishInspector(
            new DesktopEventLogEvent({
              kind: "query",
              status: "success",
              operation: "DesktopEventLog.query",
              ...(queryOptions.primaryKey === undefined
                ? {}
                : { primaryKey: queryOptions.primaryKey }),
              ...(queryOptions.namespace === undefined
                ? {}
                : { namespace: queryOptions.namespace }),
              timestamp: Date.now()
            })
          )
        ),
        Effect.catch((error: EventJournal.EventJournalError) =>
          publishInspector(
            new DesktopEventLogEvent({
              kind: "query",
              status: "failure",
              operation: "DesktopEventLog.query",
              errorTag: error._tag,
              message: `${error.method} failed`,
              timestamp: Date.now()
            })
          ).pipe(Effect.andThen(Effect.fail(error)))
        )
      )

    return DesktopEventLog.of({
      append,
      query,
      destroy: log.destroy
    })
  })

const applyQueryPolicy = (
  entries: readonly EventJournal.Entry[],
  query: DesktopEventLogQuery,
  maxQueryEntries = defaultMaxQueryEntries
): Effect.Effect<readonly DesktopEventLogRecord[]> => {
  const limit = Math.max(0, Math.min(query.limit ?? maxQueryEntries, maxQueryEntries))
  return Effect.gen(function* () {
    const selected: DesktopEventLogRecord[] = []
    for (let index = entries.length - 1; index >= 0 && selected.length < limit; index -= 1) {
      const entry = entries[index]
      if (entry === undefined || entry.event !== desktopEventLogTag) {
        continue
      }
      const payload = yield* decodeDesktopEventLogPayload(entry.payload)
      if (query.kind !== undefined && payload.kind !== query.kind) {
        continue
      }
      if (query.primaryKey !== undefined && entry.primaryKey !== query.primaryKey) {
        continue
      }
      if (query.namespace !== undefined && payload.namespace !== query.namespace) {
        continue
      }
      selected.push({
        entryId: entry.idString,
        event: entry.event,
        primaryKey: entry.primaryKey,
        payload
      })
    }
    return selected.reverse()
  })
}

const decodeDesktopEventLogPayload = (payload: Uint8Array): Effect.Effect<DesktopEventLogEvent> => {
  const definition = DesktopEventLogGroup.events[desktopEventLogTag]
  if (definition === undefined) {
    return Effect.die("DesktopEventLogGroup is missing the desktop-event-log event")
  }
  return Schema.decodeUnknownEffect(definition.payloadMsgPack)(payload).pipe(Effect.orDie)
}

export const DesktopEventLogLayer = (
  options: DesktopEventLogPolicyOptions = {}
): Layer.Layer<DesktopEventLog, never, EventLog.EventLog | EventLogInspectorCollector> =>
  Layer.effect(
    DesktopEventLog,
    Effect.gen(function* () {
      const log = yield* EventLog.EventLog
      const inspector = yield* EventLogInspectorCollector
      return yield* makeDesktopEventLog(log, inspector, options)
    })
  )

export const DesktopEventLogIdentityLive: Layer.Layer<EventLog.Identity, never, never> =
  Layer.effect(EventLog.Identity, EventLog.makeIdentity).pipe(
    Layer.provide(EventLogEncryption.layerSubtle)
  )

export const DesktopEventLogMemoryJournalLive: Layer.Layer<
  EventJournal.EventJournal,
  never,
  never
> = EventJournal.layerMemory

export const DesktopEventLogLive = (
  options: DesktopEventLogPolicyOptions = {}
): Layer.Layer<DesktopEventLog, never, EventLogInspectorCollector> =>
  DesktopEventLogLayer(options).pipe(
    Layer.provide(
      EventLog.layer(DesktopEventSchema, DesktopEventLogHandlersLive).pipe(
        Layer.provide(DesktopEventLogMemoryJournalLive),
        Layer.provide(DesktopEventLogIdentityLive)
      )
    )
  )

export const DesktopEventLogNoopInspectorLive: Layer.Layer<
  EventLogInspectorCollector,
  never,
  never
> = Layer.succeed(EventLogInspectorCollector, disabledEventLogInspectorCollector)
