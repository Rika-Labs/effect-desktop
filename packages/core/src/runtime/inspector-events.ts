import { BridgeRuntime, Rpc, RpcGroup } from "@effect-desktop/bridge"
import { Context, Effect, Layer, PubSub, Schema, Stream } from "effect"

const NonNegativeNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
const OptionalString = Schema.optionalKey(Schema.String)

export const InspectorEventStatus = Schema.Literals([
  "start",
  "success",
  "failure",
  "interruption",
  "cleanup"
])
export type InspectorEventStatus = typeof InspectorEventStatus.Type

export class ExecutionEvent extends Schema.Class<ExecutionEvent>("ExecutionEvent")({
  kind: Schema.Literals(["process", "worker", "pty"]),
  status: InspectorEventStatus,
  operation: Schema.String,
  traceId: OptionalString,
  resourceId: OptionalString,
  ownerScope: OptionalString,
  command: OptionalString,
  script: OptionalString,
  pid: Schema.optionalKey(Schema.Number),
  exitCode: Schema.optionalKey(Schema.Number),
  signal: OptionalString,
  errorTag: OptionalString,
  message: OptionalString,
  timestamp: NonNegativeNumber
}) {}

export class FilesystemInspectorEvent extends Schema.Class<FilesystemInspectorEvent>(
  "FilesystemInspectorEvent"
)({
  kind: Schema.Literals(["operation", "watch"]),
  status: InspectorEventStatus,
  operation: Schema.String,
  traceId: OptionalString,
  resourceId: OptionalString,
  ownerScope: OptionalString,
  path: OptionalString,
  directory: OptionalString,
  eventKind: OptionalString,
  errorTag: OptionalString,
  message: OptionalString,
  timestamp: NonNegativeNumber
}) {}

export class NativeHostEvent extends Schema.Class<NativeHostEvent>("NativeHostEvent")({
  kind: Schema.Literals([
    "host",
    "window",
    "webview",
    "app",
    "protocol",
    "updater",
    "crash-reporter",
    "menu",
    "tray",
    "dock",
    "platform"
  ]),
  status: InspectorEventStatus,
  operation: Schema.String,
  traceId: OptionalString,
  resourceId: OptionalString,
  windowId: OptionalString,
  method: OptionalString,
  errorTag: OptionalString,
  message: OptionalString,
  timestamp: NonNegativeNumber
}) {}

export class InspectorEvent extends Schema.Class<InspectorEvent>("InspectorEvent")({
  channel: Schema.Literals(["execution", "filesystem", "native-host"]),
  execution: Schema.optionalKey(ExecutionEvent),
  filesystem: Schema.optionalKey(FilesystemInspectorEvent),
  nativeHost: Schema.optionalKey(NativeHostEvent)
}) {}

export interface ExecutionInspectorCollectorApi {
  readonly publish: (event: ExecutionEvent) => Effect.Effect<void, never, never>
  readonly events: Stream.Stream<ExecutionEvent, never, never>
}

export interface FilesystemInspectorCollectorApi {
  readonly publish: (event: FilesystemInspectorEvent) => Effect.Effect<void, never, never>
  readonly events: Stream.Stream<FilesystemInspectorEvent, never, never>
}

export interface NativeHostInspectorCollectorApi {
  readonly publish: (event: NativeHostEvent) => Effect.Effect<void, never, never>
  readonly events: Stream.Stream<NativeHostEvent, never, never>
}

export class ExecutionInspectorCollector extends Context.Service<
  ExecutionInspectorCollector,
  ExecutionInspectorCollectorApi
>()("ExecutionInspectorCollector") {}

export class FilesystemInspectorCollector extends Context.Service<
  FilesystemInspectorCollector,
  FilesystemInspectorCollectorApi
>()("FilesystemInspectorCollector") {}

export class NativeHostInspectorCollector extends Context.Service<
  NativeHostInspectorCollector,
  NativeHostInspectorCollectorApi
>()("NativeHostInspectorCollector") {}

export interface InspectorCollectorsApi {
  readonly execution: ExecutionInspectorCollectorApi
  readonly filesystem: FilesystemInspectorCollectorApi
  readonly nativeHost: NativeHostInspectorCollectorApi
  readonly events: Stream.Stream<InspectorEvent, never, never>
}

export class InspectorCollectors extends Context.Service<
  InspectorCollectors,
  InspectorCollectorsApi
>()("InspectorCollectors") {}

const makeCollector = <A>(): Effect.Effect<
  {
    readonly publish: (event: A) => Effect.Effect<void, never, never>
    readonly events: Stream.Stream<A, never, never>
  },
  never,
  never
> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.sliding<A>({ capacity: 1024, replay: 128 })
    return Object.freeze({
      publish: (event: A) => PubSub.publish(pubsub, event).pipe(Effect.asVoid),
      events: Stream.fromPubSub(pubsub)
    })
  })

export const makeExecutionInspectorCollector = (): Effect.Effect<
  ExecutionInspectorCollectorApi,
  never,
  never
> => makeCollector<ExecutionEvent>()

export const makeFilesystemInspectorCollector = (): Effect.Effect<
  FilesystemInspectorCollectorApi,
  never,
  never
> => makeCollector<FilesystemInspectorEvent>()

export const makeNativeHostInspectorCollector = (): Effect.Effect<
  NativeHostInspectorCollectorApi,
  never,
  never
> => makeCollector<NativeHostEvent>()

export const makeInspectorCollectors = (): Effect.Effect<InspectorCollectorsApi, never, never> =>
  Effect.gen(function* () {
    const execution = yield* makeExecutionInspectorCollector()
    const filesystem = yield* makeFilesystemInspectorCollector()
    const nativeHost = yield* makeNativeHostInspectorCollector()

    return Object.freeze({
      execution,
      filesystem,
      nativeHost,
      events: Stream.mergeAll(
        [
          execution.events.pipe(
            Stream.map((event) => new InspectorEvent({ channel: "execution", execution: event }))
          ),
          filesystem.events.pipe(
            Stream.map(
              (event) => new InspectorEvent({ channel: "filesystem", filesystem: event })
            )
          ),
          nativeHost.events.pipe(
            Stream.map((event) => new InspectorEvent({ channel: "native-host", nativeHost: event }))
          )
        ],
        { concurrency: 3 }
      )
    } satisfies InspectorCollectorsApi)
  })

export const ExecutionInspectorCollectorLive: Layer.Layer<
  ExecutionInspectorCollector,
  never,
  never
> = Layer.effect(ExecutionInspectorCollector, makeExecutionInspectorCollector())

export const FilesystemInspectorCollectorLive: Layer.Layer<
  FilesystemInspectorCollector,
  never,
  never
> = Layer.effect(FilesystemInspectorCollector, makeFilesystemInspectorCollector())

export const NativeHostInspectorCollectorLive: Layer.Layer<
  NativeHostInspectorCollector,
  never,
  never
> = Layer.effect(NativeHostInspectorCollector, makeNativeHostInspectorCollector())

export const InspectorCollectorsLive: Layer.Layer<InspectorCollectors, never, never> = Layer.effect(
  InspectorCollectors,
  makeInspectorCollectors()
)

export const InspectorExecutionEvents = Rpc.make("Inspector.events.execution", {
  success: ExecutionEvent,
  error: Schema.Never,
  stream: true
}).pipe(BridgeRuntime({ backpressure: { strategy: "drop", size: 1024 } }))

export const InspectorFilesystemEvents = Rpc.make("Inspector.events.filesystem", {
  success: FilesystemInspectorEvent,
  error: Schema.Never,
  stream: true
}).pipe(BridgeRuntime({ backpressure: { strategy: "drop", size: 1024 } }))

export const InspectorNativeHostEvents = Rpc.make("Inspector.events.nativeHost", {
  success: NativeHostEvent,
  error: Schema.Never,
  stream: true
}).pipe(BridgeRuntime({ backpressure: { strategy: "drop", size: 1024 } }))

export const InspectorEventRpcs = RpcGroup.make(
  InspectorExecutionEvents,
  InspectorFilesystemEvents,
  InspectorNativeHostEvents
)

export type InspectorEventRpc = RpcGroup.Rpcs<typeof InspectorEventRpcs>

export const disabledExecutionInspectorCollector: ExecutionInspectorCollectorApi = Object.freeze({
  publish: () => Effect.void,
  events: Stream.empty
})

export const disabledFilesystemInspectorCollector: FilesystemInspectorCollectorApi = Object.freeze({
  publish: () => Effect.void,
  events: Stream.empty
})

export const disabledNativeHostInspectorCollector: NativeHostInspectorCollectorApi = Object.freeze({
  publish: () => Effect.void,
  events: Stream.empty
})
