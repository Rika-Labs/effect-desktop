import { Effect, Queue, Schema, Stream } from "effect"

import {
  type BridgeRpcGroup,
  type BridgeRpcEvents,
  type BridgeRpcSpec,
  type BridgeRpcEventSpec
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
    Events extends BridgeRpcEvents,
    Contract extends ContractWithEvents<Events>,
    Event extends keyof Events
  >(
    contract: Contract,
    event: Event,
    payload: Schema.Schema.Type<Events[Event]["payload"]>
  ) => Effect.Effect<void, HostProtocolError, never>
}

type EventChannel = {
  readonly spec: BridgeRpcEventSpec
  readonly queues: Set<EventQueue>
}

type EventQueue = {
  readonly queue: Queue.Queue<HostProtocolEventEnvelope>
}

type EventOverflow = NonNullable<NonNullable<BridgeRpcEventSpec["backpressure"]>["overflow"]>

export const EventHub = (
  contracts: Iterable<BridgeRpcGroup>,
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

type ContractWithEvents<Events extends BridgeRpcEvents> = BridgeRpcGroup<
  string,
  BridgeRpcSpec,
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

const publish = <Events extends BridgeRpcEvents, Event extends keyof Events>(
  channels: ReadonlyMap<string, EventChannel>,
  options: ResolvedBridgeEventHubOptions,
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

const makeEventQueue = (spec: BridgeRpcEventSpec): Effect.Effect<EventQueue, never, never> =>
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

const resolveEventOverflow = (spec: BridgeRpcEventSpec): EventOverflow => {
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

const encodeEventPayload = <Spec extends BridgeRpcEventSpec>(
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
