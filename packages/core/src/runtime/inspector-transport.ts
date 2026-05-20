import { Clock, Context, Data, Effect, Layer, Queue, Random, Ref, Schema, Stream } from "effect"

export class InspectorSession extends Schema.Class<InspectorSession>("InspectorSession")({
  sessionId: Schema.NonEmptyString,
  startedAt: Schema.Number,
  label: Schema.optionalKey(Schema.String)
}) {}

export class InspectorTransportEvent extends Schema.Class<InspectorTransportEvent>(
  "InspectorTransportEvent"
)({
  sequence: Schema.Number,
  sessionId: Schema.NonEmptyString,
  timestampMs: Schema.Number,
  source: Schema.NonEmptyString,
  payload: Schema.Unknown
}) {}

export class InspectorTransportSnapshot extends Schema.Class<InspectorTransportSnapshot>(
  "InspectorTransportSnapshot"
)({
  session: InspectorSession,
  retainedEvents: Schema.Number,
  oldestSequence: Schema.optionalKey(Schema.Number),
  newestSequence: Schema.optionalKey(Schema.Number),
  droppedByRetention: Schema.Number,
  droppedBySubscribers: Schema.Number,
  activeSubscribers: Schema.Number
}) {}

export interface InspectorEventInput {
  readonly source: string
  readonly payload: unknown
  readonly timestampMs?: number
}

export interface InspectorReplayRequest {
  readonly afterSequence?: number
  readonly limit?: number
}

export interface InspectorTransportOptions {
  readonly sessionId?: string
  readonly sessionLabel?: string
  readonly retentionLimit?: number
  readonly subscriberBuffer?: number
  readonly now?: () => number
}

export interface InspectorTransportApi {
  readonly session: InspectorSession
  readonly publish: (
    input: InspectorEventInput
  ) => Effect.Effect<InspectorTransportEvent, InspectorTransportInvalidArgumentError, never>
  readonly replay: (
    request?: InspectorReplayRequest
  ) => Effect.Effect<
    readonly InspectorTransportEvent[],
    InspectorTransportInvalidArgumentError,
    never
  >
  readonly subscribe: (
    request?: InspectorReplayRequest
  ) => Stream.Stream<InspectorTransportEvent, InspectorTransportInvalidArgumentError, never>
  readonly snapshot: () => Effect.Effect<InspectorTransportSnapshot, never, never>
}

export class InspectorTransportInvalidArgumentError extends Data.TaggedError("InvalidArgument")<{
  readonly operation: string
  readonly field: string
  readonly message: string
}> {}

interface InspectorRetentionState {
  readonly events: readonly InspectorTransportEvent[]
  readonly droppedByRetention: number
  readonly droppedBySubscribers: number
  readonly subscribers: ReadonlyMap<number, Queue.Queue<InspectorTransportEvent>>
}

const DEFAULT_RETENTION_LIMIT = 2_048
const DEFAULT_SUBSCRIBER_BUFFER = 256

export const makeInspectorTransport = (
  options: InspectorTransportOptions = {}
): Effect.Effect<InspectorTransportApi, InspectorTransportInvalidArgumentError, never> =>
  Effect.gen(function* () {
    const retentionLimit = yield* positiveIntegerOption(
      options.retentionLimit,
      DEFAULT_RETENTION_LIMIT,
      "retentionLimit"
    )
    const subscriberBuffer = yield* positiveIntegerOption(
      options.subscriberBuffer,
      DEFAULT_SUBSCRIBER_BUFFER,
      "subscriberBuffer"
    )
    const clock = yield* Clock.Clock
    const now = options.now ?? (() => clock.currentTimeMillisUnsafe())
    const sessionId = options.sessionId ?? `inspector-${yield* Random.nextUUIDv4}`
    if (sessionId.length === 0) {
      return yield* invalid("InspectorTransport.make", "sessionId", "sessionId must not be empty")
    }
    const session = new InspectorSession({
      sessionId,
      startedAt: now(),
      ...(options.sessionLabel === undefined ? {} : { label: options.sessionLabel })
    })
    const nextSequence = yield* Ref.make(0)
    const nextSubscriberId = yield* Ref.make(0)
    const state = yield* Ref.make<InspectorRetentionState>({
      events: [],
      droppedByRetention: 0,
      droppedBySubscribers: 0,
      subscribers: new Map()
    })

    const publish = (
      input: InspectorEventInput
    ): Effect.Effect<InspectorTransportEvent, InspectorTransportInvalidArgumentError, never> =>
      Effect.gen(function* () {
        if (input.source.length === 0) {
          return yield* invalid("InspectorTransport.publish", "source", "source must not be empty")
        }
        const sequence = yield* Ref.updateAndGet(nextSequence, (value) => value + 1)
        const event = new InspectorTransportEvent({
          sequence,
          sessionId,
          timestampMs: input.timestampMs ?? now(),
          source: input.source,
          payload: input.payload
        })
        const subscribers = yield* Ref.modify(state, (current) => {
          const appended = [...current.events, event]
          const overflow = Math.max(0, appended.length - retentionLimit)
          return [
            current.subscribers,
            {
              ...current,
              events: overflow === 0 ? appended : appended.slice(overflow),
              droppedByRetention: current.droppedByRetention + overflow
            }
          ]
        })
        for (const subscriber of subscribers.values()) {
          const accepted = yield* Queue.offer(subscriber, event)
          if (!accepted) {
            yield* Ref.update(state, (current) => ({
              ...current,
              droppedBySubscribers: current.droppedBySubscribers + 1
            }))
          }
        }
        return event
      })

    const replay = (
      request: InspectorReplayRequest = {}
    ): Effect.Effect<
      readonly InspectorTransportEvent[],
      InspectorTransportInvalidArgumentError,
      never
    > =>
      Effect.gen(function* () {
        const limit = yield* replayLimit(request.limit, retentionLimit)
        const retained = yield* Ref.get(state).pipe(Effect.map((current) => current.events))
        const afterSequence = request.afterSequence ?? 0
        if (!Number.isInteger(afterSequence) || afterSequence < 0) {
          return yield* invalid(
            "InspectorTransport.replay",
            "afterSequence",
            "afterSequence must be a non-negative integer"
          )
        }
        return retained.filter((event) => event.sequence > afterSequence).slice(-limit)
      })

    const snapshot = (): Effect.Effect<InspectorTransportSnapshot, never, never> =>
      Ref.get(state).pipe(
        Effect.map((current) => {
          const oldest = current.events[0]?.sequence
          const newest = current.events.at(-1)?.sequence
          return new InspectorTransportSnapshot({
            session,
            retainedEvents: current.events.length,
            ...(oldest === undefined ? {} : { oldestSequence: oldest }),
            ...(newest === undefined ? {} : { newestSequence: newest }),
            droppedByRetention: current.droppedByRetention,
            droppedBySubscribers: current.droppedBySubscribers,
            activeSubscribers: current.subscribers.size
          })
        })
      )

    const subscribe = (
      request: InspectorReplayRequest = {}
    ): Stream.Stream<InspectorTransportEvent, InspectorTransportInvalidArgumentError, never> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const replayed = yield* replay(request)
          const queue = yield* Queue.dropping<InspectorTransportEvent>(subscriberBuffer)
          const subscriberId = yield* Ref.updateAndGet(nextSubscriberId, (value) => value + 1)
          yield* Ref.update(state, (current) => ({
            ...current,
            subscribers: new Map(current.subscribers).set(subscriberId, queue)
          }))
          for (const event of replayed) {
            const accepted = yield* Queue.offer(queue, event)
            if (!accepted) {
              yield* Ref.update(state, (current) => ({
                ...current,
                droppedBySubscribers: current.droppedBySubscribers + 1
              }))
            }
          }
          return Stream.fromQueue(queue).pipe(
            Stream.ensuring(
              Ref.update(state, (current) => {
                const subscribers = new Map(current.subscribers)
                subscribers.delete(subscriberId)
                return { ...current, subscribers }
              }).pipe(Effect.andThen(Queue.shutdown(queue)))
            )
          )
        })
      )

    return Object.freeze({
      session,
      publish,
      replay,
      subscribe,
      snapshot
    } satisfies InspectorTransportApi)
  })

export class InspectorTransport extends Context.Service<
  InspectorTransport,
  InspectorTransportApi
>()("@orika/core/runtime/inspector-transport/InspectorTransport", {
  make: makeInspectorTransport()
}) {}

export const InspectorTransportLive = (
  options: InspectorTransportOptions = {}
): Layer.Layer<InspectorTransport, InspectorTransportInvalidArgumentError, never> =>
  Layer.effect(InspectorTransport)(makeInspectorTransport(options))

const positiveIntegerOption = (
  value: number | undefined,
  fallback: number,
  field: string
): Effect.Effect<number, InspectorTransportInvalidArgumentError, never> => {
  const resolved = value ?? fallback
  if (Number.isInteger(resolved) && resolved > 0) {
    return Effect.succeed(resolved)
  }
  return invalid("InspectorTransport.make", field, `${field} must be a positive integer`)
}

const replayLimit = (
  value: number | undefined,
  fallback: number
): Effect.Effect<number, InspectorTransportInvalidArgumentError, never> => {
  const resolved = value ?? fallback
  if (Number.isInteger(resolved) && resolved > 0) {
    return Effect.succeed(resolved)
  }
  return invalid("InspectorTransport.replay", "limit", "limit must be a positive integer")
}

const invalid = (
  operation: string,
  field: string,
  message: string
): Effect.Effect<never, InspectorTransportInvalidArgumentError, never> =>
  Effect.fail(new InspectorTransportInvalidArgumentError({ operation, field, message }))
