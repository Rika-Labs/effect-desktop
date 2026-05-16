import { Clock, Effect, PubSub, Schema, Stream } from "effect"

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
  readonly now?: (() => number) | undefined
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
  readonly pubsub: PubSub.PubSub<HostProtocolEventEnvelope>
}

type EventOverflow = Exclude<
  NonNullable<NonNullable<BridgeEventSpec["backpressure"]>["overflow"]>,
  "error"
>

export const EventHub = (
  contracts: Iterable<BridgeContract>,
  options: BridgeEventHubOptions = {}
): Effect.Effect<BridgeEventHub, HostProtocolError, never> =>
  Effect.gen(function* () {
    const resolved = resolveOptions(options)
    const channels = new Map<string, EventChannel>()

    for (const contract of contracts) {
      for (const [event, spec] of Object.entries(contract.events ?? {})) {
        const method = eventName(contract.tag, event)
        const pubsub = yield* makeEventPubSub(method, spec)
        channels.set(method, {
          spec,
          pubsub
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

  return Stream.fromPubSub(channel.pubsub)
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
    const timestamp = yield* currentTimeMillis(options.now).pipe(
      Effect.flatMap((now) => validateHostProtocolTimestamp(now, method))
    )
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

    yield* PubSub.publish(channel.pubsub, envelope).pipe(Effect.asVoid)
  })

const makeEventPubSub = (
  method: string,
  spec: BridgeEventSpec
): Effect.Effect<PubSub.PubSub<HostProtocolEventEnvelope>, HostProtocolError, never> =>
  Effect.gen(function* () {
    const capacity = spec.backpressure?.size ?? DEFAULT_EVENT_QUEUE_SIZE
    if (capacity <= 0) {
      return yield* Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "backpressure.size",
          "event backpressure size must be a positive integer",
          method
        )
      )
    }
    if (spec.backpressure?.overflow === "error") {
      return yield* Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "backpressure.overflow",
          "event overflow error is not supported",
          method
        )
      )
    }
    const overflow = resolveEventOverflow(spec)

    return overflow === "dropOldest"
      ? yield* PubSub.sliding<HostProtocolEventEnvelope>({ capacity, replay: 0 })
      : overflow === "dropNewest"
        ? yield* PubSub.dropping<HostProtocolEventEnvelope>({ capacity, replay: 0 })
        : yield* PubSub.bounded<HostProtocolEventEnvelope>({ capacity, replay: 0 })
  })

const resolveEventOverflow = (spec: BridgeEventSpec): EventOverflow => {
  if (spec.backpressure?.overflow !== undefined && spec.backpressure.overflow !== "error") {
    return spec.backpressure.overflow
  }

  return spec.backpressure?.strategy === "drop" ? "dropNewest" : "block"
}

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
  now: options.now,
  nextTraceId: options.nextTraceId ?? (() => `trace-${globalThis.crypto.randomUUID()}`),
  windowId: options.windowId
})

const currentTimeMillis = (now: (() => number) | undefined): Effect.Effect<number, never, never> =>
  now === undefined ? Clock.currentTimeMillis : Effect.sync(now)

const eventName = (tag: string, event: string): string => `${tag}.${event}`

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
