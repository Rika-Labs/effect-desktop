import { Effect, PubSub, Schema, Stream } from "effect"

const InspectorTimestamp = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
const OptionalString = Schema.optionalKey(Schema.Union([Schema.String, Schema.Undefined]))
const OptionalUnknown = Schema.optionalKey(Schema.Union([Schema.Unknown, Schema.Undefined]))

export const BridgeInspectorEventKind = Schema.Literals([
  "rpc.request",
  "rpc.response",
  "rpc.failure",
  "bridge.frame",
  "bridge.decodeFailure",
  "transport.connect",
  "transport.reconnect",
  "transport.backpressure",
  "transport.disconnect"
])
export type BridgeInspectorEventKind = typeof BridgeInspectorEventKind.Type

export const BridgeInspectorBoundary = Schema.Literals(["renderer", "bridge", "runtime", "host"])
export type BridgeInspectorBoundary = typeof BridgeInspectorBoundary.Type

export const BridgeInspectorDirection = Schema.Literals(["inbound", "outbound"])
export type BridgeInspectorDirection = typeof BridgeInspectorDirection.Type

export class BridgeInspectorEvent extends Schema.Class<BridgeInspectorEvent>(
  "BridgeInspectorEvent"
)({
  kind: BridgeInspectorEventKind,
  boundary: BridgeInspectorBoundary,
  direction: BridgeInspectorDirection,
  method: OptionalString,
  requestId: OptionalString,
  resourceId: OptionalString,
  traceId: OptionalString,
  timestamp: InspectorTimestamp,
  durationMs: Schema.optionalKey(
    Schema.Union([
      Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
      Schema.Undefined
    ])
  ),
  frameKind: OptionalString,
  errorTag: OptionalString,
  payload: OptionalUnknown
}) {}

export interface BridgeInspector {
  readonly emit: (event: BridgeInspectorEvent) => Effect.Effect<void, never, never>
  readonly events: Stream.Stream<BridgeInspectorEvent, never, never>
}

export interface BridgeInspectorOptions {
  readonly capacity?: number
  readonly onEvent?: (event: BridgeInspectorEvent) => Effect.Effect<void, never, never>
}

export const makeBridgeInspector = (
  options: BridgeInspectorOptions = {}
): Effect.Effect<BridgeInspector, never, never> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.sliding<BridgeInspectorEvent>({
      capacity: options.capacity ?? 1_024,
      replay: 0
    })
    const onEvent = options.onEvent ?? (() => Effect.void)

    return Object.freeze({
      emit: (event) => PubSub.publish(pubsub, event).pipe(Effect.andThen(onEvent(event))),
      events: Stream.fromPubSub(pubsub)
    } satisfies BridgeInspector)
  })

export const emitBridgeInspectorEvent = (
  inspector: BridgeInspector | undefined,
  event: BridgeInspectorEvent
): Effect.Effect<void, never, never> =>
  inspector === undefined ? Effect.void : inspector.emit(event)

export const hostProtocolErrorTag = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null
    ? "tag" in error
      ? String(Reflect.get(error, "tag"))
      : "_tag" in error
        ? String(Reflect.get(error, "_tag"))
        : undefined
    : undefined
