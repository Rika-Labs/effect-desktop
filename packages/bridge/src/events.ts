import { Effect, Queue, Schema, Stream } from "effect"

import {
  type ApiContractClass,
  type ApiContractEvents,
  type ApiContractSpec,
  type ApiEventSpec
} from "./contracts.js"
import {
  HostProtocolEventEnvelope,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError
} from "./protocol.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
const DEFAULT_EVENT_QUEUE_SIZE = 1_024

export interface ApiEventHubOptions {
  readonly now?: () => number
  readonly nextTraceId?: () => string
  readonly windowId?: string
}

interface ResolvedApiEventHubOptions {
  readonly now: () => number
  readonly nextTraceId: () => string
  readonly windowId: string | undefined
}

export interface ApiEventHub {
  readonly exchange: {
    readonly subscribe: (
      method: string
    ) => Stream.Stream<HostProtocolEventEnvelope, HostProtocolError, never>
  }
  readonly publish: <
    Events extends ApiContractEvents,
    Contract extends ContractWithEvents<Events>,
    Event extends keyof Events
  >(
    contract: Contract,
    event: Event,
    payload: Schema.Schema.Type<Events[Event]["payload"]>
  ) => Effect.Effect<void, HostProtocolError, never>
}

type EventChannel = {
  readonly spec: ApiEventSpec
  readonly queues: Set<EventQueue>
}

type EventQueue = {
  readonly queue: Queue.Queue<HostProtocolEventEnvelope>
}

export const EventHub = (
  contracts: Iterable<ApiContractClass>,
  options: ApiEventHubOptions = {}
): Effect.Effect<ApiEventHub, never, never> =>
  Effect.sync(() => {
    const resolved = resolveOptions(options)
    const channels = new Map<string, EventChannel>()

    for (const contract of contracts) {
      for (const [event, spec] of Object.entries(contract.events ?? {})) {
        channels.set(eventName(contract.tag, event), {
          spec,
          queues: new Set()
        })
      }
    }

    const hub: ApiEventHub = {
      exchange: Object.freeze({
        subscribe: (method: string) => subscribe(channels, method)
      }),
      publish: (contract, event, payload) =>
        publish(channels, resolved, contract, String(event), payload)
    }

    return Object.freeze(hub)
  })

type ContractWithEvents<Events extends ApiContractEvents> = ApiContractClass<
  string,
  ApiContractSpec,
  Events
> & {
  readonly events: Events
}

const subscribe = (
  channels: ReadonlyMap<string, EventChannel>,
  method: string
): Stream.Stream<HostProtocolEventEnvelope, HostProtocolError, never> => {
  const channel = channels.get(method)

  if (channel === undefined) {
    return Stream.fail(makeHostProtocolInvalidArgumentError("method", "unknown event", method))
  }

  return Stream.unwrap(
    Effect.gen(function* () {
      const eventQueue = yield* makeEventQueue(channel.spec)
      channel.queues.add(eventQueue)

      return Stream.fromQueue(eventQueue.queue).pipe(
        Stream.ensuring(
          Effect.andThen(
            Effect.sync(() => {
              channel.queues.delete(eventQueue)
            }),
            Queue.interrupt(eventQueue.queue)
          )
        )
      )
    })
  )
}

const publish = <Events extends ApiContractEvents, Event extends keyof Events>(
  channels: ReadonlyMap<string, EventChannel>,
  options: ResolvedApiEventHubOptions,
  contract: ContractWithEvents<Events>,
  event: Event,
  payload: Schema.Schema.Type<Events[Event]["payload"]>
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.gen(function* () {
    const method = eventName(contract.tag, String(event))
    const channel = channels.get(method)

    if (channel === undefined) {
      return yield* Effect.fail(
        makeHostProtocolInvalidArgumentError("method", "unknown event", method)
      )
    }

    const encodedPayload = yield* encodeEventPayload(method, channel.spec, payload)
    const envelope = new HostProtocolEventEnvelope({
      kind: "event",
      method,
      timestamp: options.now(),
      traceId: options.nextTraceId(),
      ...(options.windowId === undefined ? {} : { windowId: options.windowId }),
      ...(encodedPayload === undefined ? {} : { payload: encodedPayload })
    })

    yield* Effect.forEach(channel.queues, (eventQueue) => offerEvent(eventQueue, envelope), {
      discard: true
    })
  })

const makeEventQueue = (spec: ApiEventSpec): Effect.Effect<EventQueue, never, never> =>
  Effect.gen(function* () {
    const capacity = spec.backpressure?.size ?? DEFAULT_EVENT_QUEUE_SIZE
    const overflow = spec.backpressure?.overflow ?? "block"
    const queue =
      overflow === "dropOldest"
        ? yield* Queue.sliding<HostProtocolEventEnvelope>(capacity)
        : overflow === "dropNewest"
          ? yield* Queue.dropping<HostProtocolEventEnvelope>(capacity)
          : yield* Queue.bounded<HostProtocolEventEnvelope>(capacity)

    return {
      queue
    } as const
  })

const offerEvent = (
  eventQueue: EventQueue,
  envelope: HostProtocolEventEnvelope
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.gen(function* () {
    yield* Queue.offer(eventQueue.queue, envelope)
  })

const encodeEventPayload = <Spec extends ApiEventSpec>(
  operation: string,
  spec: Spec,
  payload: Schema.Schema.Type<Spec["payload"]>
): Effect.Effect<Schema.Codec.Encoded<Spec["payload"]>, HostProtocolError, never> =>
  Effect.mapError(
    Schema.encodeEffect(spec.payload)(payload, StrictParseOptions) as Effect.Effect<
      Schema.Codec.Encoded<Spec["payload"]>,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

const resolveOptions = (options: ApiEventHubOptions): ResolvedApiEventHubOptions => ({
  now: options.now ?? Date.now,
  nextTraceId: options.nextTraceId ?? (() => `trace-${globalThis.crypto.randomUUID()}`),
  windowId: options.windowId
})

const eventName = (tag: string, event: string): string => `${tag}.${event}`

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
