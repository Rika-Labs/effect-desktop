import { Context, Data, Effect, Option, PubSub, Ref, Schema, Stream } from "effect"

import {
  SQLite,
  type SqliteConnection,
  type SqliteError,
  type SqliteRow,
  type SqliteValue
} from "./sqlite.js"

const NonEmptyString = Schema.NonEmptyString
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const EventLogMetadataText = Schema.NonEmptyString.check(
  // eslint-disable-next-line no-control-regex
  Schema.isPattern(/^[^\x00-\x1F\x7F]+$/)
)

export class EventLogOpenInput extends Schema.Class<EventLogOpenInput>("EventLogOpenInput")({
  path: NonEmptyString,
  ownerScope: NonEmptyString,
  namespace: NonEmptyString,
  maxEvents: Schema.optionalKey(PositiveInt),
  flushEveryMs: Schema.optionalKey(PositiveInt),
  flushEveryEvents: Schema.optionalKey(PositiveInt)
}) {}

export class EventLogAppendInput extends Schema.Class<EventLogAppendInput>("EventLogAppendInput")({
  type: EventLogMetadataText,
  payload: Schema.optionalKey(Schema.Unknown),
  source: Schema.optionalKey(Schema.String)
}) {}

export class EventLogQueryInput extends Schema.Class<EventLogQueryInput>("EventLogQueryInput")({
  from: Schema.optionalKey(NonNegativeInt),
  to: Schema.optionalKey(NonNegativeInt),
  type: Schema.optionalKey(EventLogMetadataText),
  limit: Schema.optionalKey(PositiveInt)
}) {}

export class EventLogSubscribeInput extends Schema.Class<EventLogSubscribeInput>(
  "EventLogSubscribeInput"
)({
  from: Schema.optionalKey(NonNegativeInt)
}) {}

export class EventLogEntry extends Schema.Class<EventLogEntry>("EventLogEntry")({
  id: NonNegativeInt,
  type: EventLogMetadataText,
  payload: Schema.optionalKey(Schema.Unknown),
  timestampMs: NonNegativeInt,
  source: Schema.optionalKey(Schema.String)
}) {}

export class EventLogInvalidArgumentError extends Data.TaggedError("InvalidArgument")<{
  readonly operation: string
  readonly field: string
  readonly message: string
  readonly cause: Option.Option<unknown>
}> {}

export class EventLogSqliteError extends Data.TaggedError("SqliteError")<{
  readonly operation: string
  readonly cause: SqliteError
}> {}

export class EventLogFullError extends Data.TaggedError("EventLogFull")<{
  readonly freeBytes: number
  readonly operation: string
  readonly cause: Option.Option<unknown>
}> {}

export class EventLogSegmentCorruptError extends Data.TaggedError("EventLogSegmentCorrupt")<{
  readonly segmentPath: string
  readonly operation: string
  readonly cause: Option.Option<unknown>
}> {}

export type EventLogError =
  | EventLogInvalidArgumentError
  | EventLogSqliteError
  | EventLogFullError
  | EventLogSegmentCorruptError

export interface EventLogOpenOptions {
  readonly path: string
  readonly ownerScope: string
  readonly namespace?: string
  readonly maxEvents?: number
  readonly flushEveryMs?: number
  readonly flushEveryEvents?: number
  readonly now?: () => number
}

export interface EventLogAppendOptions {
  readonly source?: string
}

export interface EventLogAppend {
  readonly type: string
  readonly payload?: unknown
}

export interface EventLogQueryOptions {
  readonly from?: number
  readonly to?: number
  readonly type?: string
  readonly limit?: number
}

export interface EventLogSubscribeOptions {
  readonly from?: number
}

export interface EventLogStore {
  readonly append: (
    event: EventLogAppend,
    options?: EventLogAppendOptions
  ) => Effect.Effect<number, EventLogError, never>
  readonly query: (
    options?: EventLogQueryOptions
  ) => Effect.Effect<readonly EventLogEntry[], EventLogError, never>
  readonly subscribe: (
    options?: EventLogSubscribeOptions
  ) => Stream.Stream<EventLogEntry, EventLogError, never>
  readonly close: () => Effect.Effect<void, never, never>
}

export interface EventLogApi {
  readonly open: (
    options: EventLogOpenOptions
  ) => Effect.Effect<EventLogStore, EventLogError, never>
}

export const makeEventLog = (
  sqlite: typeof SQLite.Service
): Effect.Effect<EventLogApi, never, never> =>
  Effect.sync(() =>
    Object.freeze({
      open: (options: EventLogOpenOptions) =>
        Effect.gen(function* () {
          const input = yield* decodeOpenInput(
            {
              path: options.path,
              ownerScope: options.ownerScope,
              namespace: options.namespace ?? "default",
              ...(options.maxEvents === undefined ? {} : { maxEvents: options.maxEvents }),
              ...(options.flushEveryMs === undefined ? {} : { flushEveryMs: options.flushEveryMs }),
              ...(options.flushEveryEvents === undefined
                ? {}
                : { flushEveryEvents: options.flushEveryEvents })
            },
            "EventLog.open"
          )
          const connection = yield* sqlite
            .connect({
              path: input.path,
              ownerScope: input.ownerScope,
              create: true,
              strict: true
            })
            .pipe(Effect.mapError((error) => mapSqliteError(error, "EventLog.open")))
          const tail = yield* PubSub.sliding<EventLogEntry>({ capacity: 1024, replay: 0 })
          const readOnly = yield* Ref.make(false)
          const now = options.now ?? Date.now

          yield* initialize(connection, input)
          return makeStore(connection, input, now, tail, readOnly)
        }).pipe(
          Effect.withSpan("EventLog.open", {
            attributes: {
              path: options.path,
              ownerScope: options.ownerScope,
              namespace: options.namespace ?? "default"
            }
          })
        )
    })
  )

export class EventLog extends Context.Service<EventLog, EventLogApi>()("EventLog", {
  make: Effect.gen(function* () {
    const sqlite = yield* SQLite
    return yield* makeEventLog(sqlite)
  })
}) {}

const makeStore = (
  connection: SqliteConnection,
  input: EventLogOpenInput,
  now: () => number,
  tail: PubSub.PubSub<EventLogEntry>,
  readOnly: Ref.Ref<boolean>
): EventLogStore => {
  const append = (
    event: EventLogAppend,
    options?: EventLogAppendOptions
  ): Effect.Effect<number, EventLogError, never> =>
    Effect.gen(function* () {
      const decoded = yield* decodeAppendInput(
        {
          type: event.type,
          ...(event.payload === undefined ? {} : { payload: event.payload }),
          ...(options?.source === undefined ? {} : { source: options.source })
        },
        "EventLog.append"
      )
      const encoded = yield* encodePayload(decoded.payload, "EventLog.append")
      const timestampMs = now()
      const entry = yield* connection
        .transaction(
          Effect.gen(function* () {
            const readOnlyLatched = yield* Ref.get(readOnly)
            if (readOnlyLatched) {
              return yield* Effect.fail(eventLogFull("EventLog.append", Option.none()))
            }

            const meta = yield* readMeta(connection, input.namespace)
            if (meta.readOnly) {
              return yield* Effect.fail(eventLogFull("EventLog.append", Option.none()))
            }

            const id = meta.nextEventId
            yield* writeEvent(connection, input.namespace, id, decoded, encoded, timestampMs)
            yield* setNextEventId(connection, input.namespace, id + 1)
            yield* applyRetention(connection, input.namespace, input.maxEvents)
            return new EventLogEntry({
              id,
              type: decoded.type,
              ...(decoded.payload === undefined ? {} : { payload: decoded.payload }),
              timestampMs,
              ...(decoded.source === undefined ? {} : { source: decoded.source })
            })
          })
        )
        .pipe(
          Effect.mapError((error) => mapTransactionError(error) as EventLogError),
          Effect.catch(
            (error: EventLogError): Effect.Effect<never, EventLogError, never> =>
              error instanceof EventLogFullError
                ? Ref.set(readOnly, true).pipe(
                    Effect.flatMap(() => markReadOnly(connection, input.namespace)),
                    Effect.flatMap(() => Effect.fail(error))
                  )
                : Effect.fail(error)
          )
        )

      yield* PubSub.publish(tail, entry)
      return entry.id
    }).pipe(Effect.withSpan("EventLog.append", { attributes: { namespace: input.namespace } }))

  const query = (
    options: EventLogQueryOptions = {}
  ): Effect.Effect<readonly EventLogEntry[], EventLogError, never> =>
    Effect.gen(function* () {
      const decoded = yield* decodeQueryInput(options, "EventLog.query")
      const rows = yield* queryEvents(connection, input.namespace, decoded)
      return yield* Effect.all(
        rows.map((row) => rowToEntry(row, "EventLog.query")),
        { concurrency: 1 }
      )
    }).pipe(Effect.withSpan("EventLog.query", { attributes: { namespace: input.namespace } }))

  return Object.freeze({
    append,
    query,
    subscribe: (options: EventLogSubscribeOptions = {}) =>
      Stream.scoped(
        Stream.unwrap(
          Effect.gen(function* () {
            const decoded = yield* decodeSubscribeInput(options, "EventLog.subscribe")
            const subscription = yield* PubSub.subscribe(tail)
            if (decoded.from === undefined) {
              return Stream.fromEffectRepeat(PubSub.take(subscription))
            }

            const replay = yield* query({ from: decoded.from })
            const replayHighWater = replay.at(-1)?.id ?? decoded.from - 1
            const live = Stream.fromEffectRepeat(PubSub.take(subscription)).pipe(
              Stream.filter((entry) => entry.id > replayHighWater)
            )
            return Stream.fromIterable(replay).pipe(Stream.concat(live))
          })
        )
      ),
    close: () => connection.close()
  })
}

const initialize = (
  connection: SqliteConnection,
  input: EventLogOpenInput
): Effect.Effect<void, EventLogError, never> =>
  Effect.gen(function* () {
    yield* exec(connection, "PRAGMA synchronous = FULL", [], "EventLog.initialize")
    yield* connection
      .transaction(
        Effect.gen(function* () {
          yield* exec(
            connection,
            "CREATE TABLE IF NOT EXISTS event_log_meta (namespace TEXT PRIMARY KEY, next_event_id INTEGER NOT NULL, read_only INTEGER NOT NULL)",
            [],
            "EventLog.initialize"
          )
          yield* exec(
            connection,
            "CREATE TABLE IF NOT EXISTS event_log_entries (namespace TEXT NOT NULL, event_id INTEGER NOT NULL, type TEXT NOT NULL, payload_json TEXT NOT NULL, payload_present INTEGER NOT NULL, source TEXT, timestamp_ms INTEGER NOT NULL, PRIMARY KEY(namespace, event_id))",
            [],
            "EventLog.initialize"
          )
          const existing = yield* queryRows(
            connection,
            "SELECT next_event_id FROM event_log_meta WHERE namespace = ?",
            [input.namespace],
            "EventLog.initialize"
          )
          if (existing.length === 0) {
            const rows = yield* queryRows(
              connection,
              "SELECT COALESCE(MAX(event_id), -1) + 1 AS next_event_id FROM event_log_entries WHERE namespace = ?",
              [input.namespace],
              "EventLog.initialize"
            )
            const nextEventId = yield* numberField(rows[0], "next_event_id", "EventLog.initialize")
            yield* exec(
              connection,
              "INSERT INTO event_log_meta (namespace, next_event_id, read_only) VALUES (?, ?, 0)",
              [input.namespace, nextEventId],
              "EventLog.initialize"
            )
          }
        })
      )
      .pipe(Effect.mapError((error) => mapTransactionError(error) as EventLogError))
  })

const readMeta = (
  connection: SqliteConnection,
  namespace: string
): Effect.Effect<
  { readonly nextEventId: number; readonly readOnly: boolean },
  EventLogError,
  never
> =>
  Effect.gen(function* () {
    const rows = yield* queryRows(
      connection,
      "SELECT next_event_id, read_only FROM event_log_meta WHERE namespace = ?",
      [namespace],
      "EventLog.append"
    )
    const row = rows[0]
    if (row === undefined) {
      return yield* Effect.fail(
        new EventLogInvalidArgumentError({
          operation: "EventLog.append",
          field: "namespace",
          message: "event log namespace is not initialized",
          cause: Option.none()
        })
      )
    }

    return {
      nextEventId: yield* numberField(row, "next_event_id", "EventLog.append"),
      readOnly: (yield* numberField(row, "read_only", "EventLog.append")) === 1
    }
  })

const writeEvent = (
  connection: SqliteConnection,
  namespace: string,
  id: number,
  input: EventLogAppendInput,
  payloadJson: string,
  timestampMs: number
): Effect.Effect<void, EventLogError, never> =>
  exec(
    connection,
    "INSERT INTO event_log_entries (namespace, event_id, type, payload_json, payload_present, source, timestamp_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      namespace,
      id,
      input.type,
      payloadJson,
      input.payload === undefined ? 0 : 1,
      input.source ?? null,
      timestampMs
    ],
    "EventLog.append"
  )

const setNextEventId = (
  connection: SqliteConnection,
  namespace: string,
  nextEventId: number
): Effect.Effect<void, EventLogError, never> =>
  exec(
    connection,
    "UPDATE event_log_meta SET next_event_id = ? WHERE namespace = ?",
    [nextEventId, namespace],
    "EventLog.append"
  )

const markReadOnly = (
  connection: SqliteConnection,
  namespace: string
): Effect.Effect<void, never, never> =>
  exec(
    connection,
    "UPDATE event_log_meta SET read_only = 1 WHERE namespace = ?",
    [namespace],
    "EventLog.append"
  ).pipe(
    Effect.catch((error: EventLogError) =>
      Effect.logWarning("EventLog.markReadOnly failed", {
        namespace,
        failure: error._tag,
        operation: error.operation,
        reason: formatUnknownError(error)
      })
    )
  )

const applyRetention = (
  connection: SqliteConnection,
  namespace: string,
  maxEvents: number | undefined
): Effect.Effect<void, EventLogError, never> =>
  maxEvents === undefined
    ? Effect.void
    : exec(
        connection,
        "DELETE FROM event_log_entries WHERE namespace = ? AND event_id NOT IN (SELECT event_id FROM event_log_entries WHERE namespace = ? ORDER BY event_id DESC LIMIT ?)",
        [namespace, namespace, maxEvents],
        "EventLog.retention"
      )

const queryEvents = (
  connection: SqliteConnection,
  namespace: string,
  input: EventLogQueryInput
): Effect.Effect<readonly SqliteRow[], EventLogError, never> => {
  const clauses = ["namespace = ?"]
  const params: SqliteValue[] = [namespace]
  if (input.from !== undefined) {
    clauses.push("event_id >= ?")
    params.push(input.from)
  }
  if (input.to !== undefined) {
    clauses.push("event_id <= ?")
    params.push(input.to)
  }
  if (input.type !== undefined) {
    clauses.push("type = ?")
    params.push(input.type)
  }

  const limit = input.limit ?? 1024
  params.push(limit)
  return queryRows(
    connection,
    `SELECT event_id, type, payload_json, payload_present, source, timestamp_ms FROM event_log_entries WHERE ${clauses.join(
      " AND "
    )} ORDER BY event_id ASC LIMIT ?`,
    params,
    "EventLog.query"
  )
}

const queryRows = (
  connection: SqliteConnection,
  sql: string,
  params: readonly SqliteValue[],
  operation: string
): Effect.Effect<readonly SqliteRow[], EventLogError, never> =>
  connection.query(sql, params).pipe(Effect.mapError((error) => mapSqliteError(error, operation)))

const exec = (
  connection: SqliteConnection,
  sql: string,
  params: readonly SqliteValue[],
  operation: string
): Effect.Effect<void, EventLogError, never> =>
  connection.exec(sql, params).pipe(
    Effect.asVoid,
    Effect.mapError((error) => mapSqliteError(error, operation))
  )

const rowToEntry = (
  row: SqliteRow,
  operation: string
): Effect.Effect<EventLogEntry, EventLogError, never> =>
  Effect.gen(function* () {
    const payloadJson = yield* stringField(row, "payload_json", operation)
    const payloadPresent = (yield* numberField(row, "payload_present", operation)) === 1
    const payload = yield* decodePayload(payloadJson, operation)
    const source = row["source"]
    if (source !== null && source !== undefined && typeof source !== "string") {
      return yield* Effect.fail(
        new EventLogInvalidArgumentError({
          operation,
          field: "source",
          message: "stored event source is not text",
          cause: Option.none()
        })
      )
    }

    const type = yield* stringField(row, "type", operation)
    const decodedType = yield* decodeMetadataField(type, operation, "type")
    return new EventLogEntry({
      id: yield* numberField(row, "event_id", operation),
      type: decodedType,
      ...(payloadPresent ? { payload } : {}),
      timestampMs: yield* numberField(row, "timestamp_ms", operation),
      ...(source === null || source === undefined ? {} : { source })
    })
  })

const decodeMetadataField = (
  value: string,
  operation: string,
  field: string
): Effect.Effect<string, EventLogInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(EventLogMetadataText)(value).pipe(
    Effect.mapError(
      (cause) =>
        new EventLogInvalidArgumentError({
          operation,
          field,
          message: formatUnknownError(cause),
          cause: Option.some(cause)
        })
    )
  )

const decodeOpenInput = (
  input: unknown,
  operation: string
): Effect.Effect<EventLogOpenInput, EventLogInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(EventLogOpenInput)(input).pipe(
    Effect.mapError(
      (error) =>
        new EventLogInvalidArgumentError({
          operation,
          field: "payload",
          message: formatUnknownError(error),
          cause: Option.some(error)
        })
    )
  )

const decodeAppendInput = (
  input: unknown,
  operation: string
): Effect.Effect<EventLogAppendInput, EventLogInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(EventLogAppendInput)(input).pipe(
    Effect.mapError(
      (error) =>
        new EventLogInvalidArgumentError({
          operation,
          field: "payload",
          message: formatUnknownError(error),
          cause: Option.some(error)
        })
    )
  )

const decodeQueryInput = (
  input: unknown,
  operation: string
): Effect.Effect<EventLogQueryInput, EventLogInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(EventLogQueryInput)(input).pipe(
    Effect.mapError(
      (error) =>
        new EventLogInvalidArgumentError({
          operation,
          field: "query",
          message: formatUnknownError(error),
          cause: Option.some(error)
        })
    )
  )

const decodeSubscribeInput = (
  input: unknown,
  operation: string
): Effect.Effect<EventLogSubscribeInput, EventLogInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(EventLogSubscribeInput)(input).pipe(
    Effect.mapError(
      (error) =>
        new EventLogInvalidArgumentError({
          operation,
          field: "subscribe",
          message: formatUnknownError(error),
          cause: Option.some(error)
        })
    )
  )

const encodePayload = (
  payload: unknown,
  operation: string
): Effect.Effect<string, EventLogInvalidArgumentError, never> =>
  Effect.try({
    try: () => JSON.stringify(payload === undefined ? null : payload),
    catch: (error) =>
      new EventLogInvalidArgumentError({
        operation,
        field: "payload",
        message: formatUnknownError(error),
        cause: Option.some(error)
      })
  })

const decodePayload = (
  payloadJson: string,
  operation: string
): Effect.Effect<unknown, EventLogInvalidArgumentError, never> =>
  Effect.try({
    try: () => JSON.parse(payloadJson) as unknown,
    catch: (error) =>
      new EventLogInvalidArgumentError({
        operation,
        field: "payload_json",
        message: formatUnknownError(error),
        cause: Option.some(error)
      })
  })

const numberField = (
  row: SqliteRow | undefined,
  field: string,
  operation: string
): Effect.Effect<number, EventLogInvalidArgumentError, never> => {
  const value = row?.[field]
  if (typeof value === "number") {
    return Effect.succeed(value)
  }

  return Effect.fail(
    new EventLogInvalidArgumentError({
      operation,
      field,
      message: "stored event field is not numeric",
      cause: Option.none()
    })
  )
}

const stringField = (
  row: SqliteRow,
  field: string,
  operation: string
): Effect.Effect<string, EventLogInvalidArgumentError, never> => {
  const value = row[field]
  if (typeof value === "string") {
    return Effect.succeed(value)
  }

  return Effect.fail(
    new EventLogInvalidArgumentError({
      operation,
      field,
      message: "stored event field is not text",
      cause: Option.none()
    })
  )
}

const mapTransactionError = <E>(error: E | EventLogError | SqliteError): E | EventLogError => {
  if (isEventLogError(error)) {
    return error
  }

  if (isSqliteError(error)) {
    return mapSqliteError(error, "EventLog.transaction")
  }

  return error
}

const mapSqliteError = (error: SqliteError, operation: string): EventLogError => {
  if (Option.getOrUndefined(error.code)?.startsWith("SQLITE_FULL") === true) {
    return eventLogFull(operation, Option.some(error))
  }

  return new EventLogSqliteError({ operation, cause: error })
}

const eventLogFull = (operation: string, cause: Option.Option<unknown>): EventLogFullError =>
  new EventLogFullError({
    freeBytes: 0,
    operation,
    cause
  })

const isEventLogError = (error: unknown): error is EventLogError =>
  error instanceof EventLogInvalidArgumentError ||
  error instanceof EventLogSqliteError ||
  error instanceof EventLogFullError ||
  error instanceof EventLogSegmentCorruptError

const isSqliteError = (error: unknown): error is SqliteError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  (error._tag === "Constraint" ||
    error._tag === "Busy" ||
    error._tag === "Locked" ||
    error._tag === "Corrupt" ||
    error._tag === "IoError" ||
    error._tag === "InvalidArgument" ||
    error._tag === "InvalidState")

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
