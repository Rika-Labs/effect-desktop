import { Effect, Queue, Schema, Stream } from "effect"

import {
  type BridgeContract,
  type BridgeContractCodec,
  type BridgeContractCodecType,
  type BridgeContractEvents,
  type BridgeContractSpec,
  type BridgeEventSpec
} from "./contracts.js"
import {
  HostProtocolEventEnvelope,
  makeHostProtocolInvalidArgumentError,
  validateHostProtocolNonEmptyString,
  validateHostProtocolTimestamp,
  type HostProtocolError
} from "./protocol.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
const DEFAULT_EVENT_QUEUE_SIZE = 1_024

export interface BridgeEventHubOptions {
  readonly now?: () => number
  readonly nextTraceId?: () => string
  readonly windowId?: string
}

interface ResolvedBridgeEventHubOptions {
  readonly now: () => number
  readonly nextTraceId: () => string
  readonly windowId: string | undefined
}

export interface BridgeEventHub {
  readonly exchange: {
    readonly subscribe: (
      method: string
    ) => Stream.Stream<HostProtocolEventEnvelope, HostProtocolError, never>
  }
  readonly publish: <
    Events extends BridgeContractEvents,
    Contract extends ContractWithEvents<Events>,
    Event extends keyof Events
  >(
    contract: Contract,
    event: Event,
    payload: BridgeContractCodecType<Events[Event]["payload"]>
  ) => Effect.Effect<void, HostProtocolError, never>
}

type EventChannel = {
  readonly spec: BridgeEventSpec
  readonly queues: Set<EventQueue>
}

type EventQueue = {
  readonly queue: Queue.Queue<HostProtocolEventEnvelope>
}

type EventOverflow = NonNullable<NonNullable<BridgeEventSpec["backpressure"]>["overflow"]>

export const EventHub = (
  contracts: Iterable<BridgeContract>,
  options: BridgeEventHubOptions = {}
): Effect.Effect<BridgeEventHub, never, never> =>
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

    const hub: BridgeEventHub = {
      exchange: Object.freeze({
        subscribe: (method: string) => subscribe(channels, method)
      }),
      publish: (contract, event, payload) =>
        publish(channels, resolved, contract, String(event), payload)
    }

    return Object.freeze(hub)
  })

type ContractWithEvents<Events extends BridgeContractEvents> = BridgeContract<
  string,
  BridgeContractSpec,
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

const publish = <Events extends BridgeContractEvents, Event extends keyof Events>(
  channels: ReadonlyMap<string, EventChannel>,
  options: ResolvedBridgeEventHubOptions,
  contract: ContractWithEvents<Events>,
  event: Event,
  payload: BridgeContractCodecType<Events[Event]["payload"]>
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.gen(function* () {
    const method = eventName(contract.tag, String(event))
    const channel = channels.get(method)

    if (channel === undefined) {
      return yield* Effect.fail(
        makeHostProtocolInvalidArgumentError("method", "unknown event", method)
      )
    }

    const encodedPayload = yield* encodeEventPayload(method, channel.spec.payload, payload)
    const timestamp = yield* validateHostProtocolTimestamp(options.now(), method)
    const traceId = yield* validateHostProtocolNonEmptyString(
      "traceId",
      options.nextTraceId(),
      method
    )
    const envelope = new HostProtocolEventEnvelope({
      kind: "event",
      method,
      timestamp,
      traceId,
      ...(options.windowId === undefined ? {} : { windowId: options.windowId }),
      ...(encodedPayload === undefined ? {} : { payload: encodedPayload })
    })

    yield* Effect.forEach(channel.queues, (eventQueue) => offerEvent(eventQueue, envelope), {
      discard: true
    })
  })

const makeEventQueue = (spec: BridgeEventSpec): Effect.Effect<EventQueue, never, never> =>
  Effect.gen(function* () {
    const capacity = spec.backpressure?.size ?? DEFAULT_EVENT_QUEUE_SIZE
    const overflow = resolveEventOverflow(spec)
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

const resolveEventOverflow = (spec: BridgeEventSpec): EventOverflow => {
  if (spec.backpressure?.overflow !== undefined) {
    return spec.backpressure.overflow
  }

  return spec.backpressure?.strategy === "drop" ? "dropNewest" : "block"
}

const offerEvent = (
  eventQueue: EventQueue,
  envelope: HostProtocolEventEnvelope
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.gen(function* () {
    yield* Queue.offer(eventQueue.queue, envelope)
  })

const encodeEventPayload = <Type, Encoded>(
  operation: string,
  schema: BridgeContractCodec<Type, Encoded>,
  payload: Type
): Effect.Effect<Encoded, HostProtocolError, never> =>
  Schema.encodeEffect(schema)(payload, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const resolveOptions = (options: BridgeEventHubOptions): ResolvedBridgeEventHubOptions => ({
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
