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

export class PersistenceInspectorEvent extends Schema.Class<PersistenceInspectorEvent>(
  "PersistenceInspectorEvent"
)({
  kind: Schema.Literals(["settings", "sqlite", "queue", "cache", "backup", "restore"]),
  status: InspectorEventStatus,
  operation: Schema.String,
  store: Schema.String,
  traceId: OptionalString,
  ownerScope: OptionalString,
  namespace: OptionalString,
  key: OptionalString,
  fromVersion: Schema.optionalKey(NonNegativeNumber),
  toVersion: Schema.optionalKey(NonNegativeNumber),
  durationMs: Schema.optionalKey(NonNegativeNumber),
  errorTag: OptionalString,
  message: OptionalString,
  timestamp: NonNegativeNumber
}) {}

export class WorkflowInspectorEvent extends Schema.Class<WorkflowInspectorEvent>(
  "WorkflowInspectorEvent"
)({
  kind: Schema.Literals(["workflow", "activity", "timer", "deferred", "updater", "crash-reporter"]),
  status: InspectorEventStatus,
  workflowName: Schema.String,
  executionId: Schema.String,
  operation: Schema.String,
  activityName: OptionalString,
  timerId: OptionalString,
  deferredId: OptionalString,
  traceId: OptionalString,
  errorTag: OptionalString,
  message: OptionalString,
  timestamp: NonNegativeNumber
}) {}

export class EventLogInspectorEvent extends Schema.Class<EventLogInspectorEvent>(
  "EventLogInspectorEvent"
)({
  kind: Schema.Literals(["append", "query", "recovery", "read-only-transition"]),
  status: InspectorEventStatus,
  operation: Schema.String,
  event: OptionalString,
  primaryKey: OptionalString,
  entryId: OptionalString,
  payloadBytes: Schema.optionalKey(NonNegativeNumber),
  traceId: OptionalString,
  namespace: OptionalString,
  errorTag: OptionalString,
  message: OptionalString,
  timestamp: NonNegativeNumber
}) {}

export class RendererInspectorEvent extends Schema.Class<RendererInspectorEvent>(
  "RendererInspectorEvent"
)({
  kind: Schema.Literals(["rpc", "stream", "hook", "provider", "storage"]),
  status: InspectorEventStatus,
  operation: Schema.String,
  framework: OptionalString,
  traceId: OptionalString,
  resourceId: OptionalString,
  ownerScope: OptionalString,
  errorTag: OptionalString,
  message: OptionalString,
  timestamp: NonNegativeNumber
}) {}

export class InspectorEvent extends Schema.Class<InspectorEvent>("InspectorEvent")({
  channel: Schema.Literals([
    "execution",
    "filesystem",
    "native-host",
    "persistence",
    "workflow",
    "event-log",
    "renderer"
  ]),
  execution: Schema.optionalKey(ExecutionEvent),
  filesystem: Schema.optionalKey(FilesystemInspectorEvent),
  nativeHost: Schema.optionalKey(NativeHostEvent),
  persistence: Schema.optionalKey(PersistenceInspectorEvent),
  workflow: Schema.optionalKey(WorkflowInspectorEvent),
  eventLog: Schema.optionalKey(EventLogInspectorEvent),
  renderer: Schema.optionalKey(RendererInspectorEvent)
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

export interface PersistenceInspectorCollectorApi {
  readonly publish: (event: PersistenceInspectorEvent) => Effect.Effect<void, never, never>
  readonly events: Stream.Stream<PersistenceInspectorEvent, never, never>
}

export interface WorkflowInspectorCollectorApi {
  readonly publish: (event: WorkflowInspectorEvent) => Effect.Effect<void, never, never>
  readonly events: Stream.Stream<WorkflowInspectorEvent, never, never>
}

export interface EventLogInspectorCollectorApi {
  readonly publish: (event: EventLogInspectorEvent) => Effect.Effect<void, never, never>
  readonly events: Stream.Stream<EventLogInspectorEvent, never, never>
}

export interface RendererInspectorCollectorApi {
  readonly publish: (event: RendererInspectorEvent) => Effect.Effect<void, never, never>
  readonly events: Stream.Stream<RendererInspectorEvent, never, never>
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

export class PersistenceInspectorCollector extends Context.Service<
  PersistenceInspectorCollector,
  PersistenceInspectorCollectorApi
>()("PersistenceInspectorCollector") {}

export class WorkflowInspectorCollector extends Context.Service<
  WorkflowInspectorCollector,
  WorkflowInspectorCollectorApi
>()("WorkflowInspectorCollector") {}

export class EventLogInspectorCollector extends Context.Service<
  EventLogInspectorCollector,
  EventLogInspectorCollectorApi
>()("EventLogInspectorCollector") {}

export class RendererInspectorCollector extends Context.Service<
  RendererInspectorCollector,
  RendererInspectorCollectorApi
>()("RendererInspectorCollector") {}

export interface InspectorCollectorsApi {
  readonly execution: ExecutionInspectorCollectorApi
  readonly filesystem: FilesystemInspectorCollectorApi
  readonly nativeHost: NativeHostInspectorCollectorApi
  readonly persistence: PersistenceInspectorCollectorApi
  readonly workflow: WorkflowInspectorCollectorApi
  readonly eventLog: EventLogInspectorCollectorApi
  readonly renderer: RendererInspectorCollectorApi
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

export const makePersistenceInspectorCollector = (): Effect.Effect<
  PersistenceInspectorCollectorApi,
  never,
  never
> => makeCollector<PersistenceInspectorEvent>()

export const makeWorkflowInspectorCollector = (): Effect.Effect<
  WorkflowInspectorCollectorApi,
  never,
  never
> => makeCollector<WorkflowInspectorEvent>()

export const makeEventLogInspectorCollector = (): Effect.Effect<
  EventLogInspectorCollectorApi,
  never,
  never
> => makeCollector<EventLogInspectorEvent>()

export const makeRendererInspectorCollector = (): Effect.Effect<
  RendererInspectorCollectorApi,
  never,
  never
> => makeCollector<RendererInspectorEvent>()

export const makeInspectorCollectors = (): Effect.Effect<InspectorCollectorsApi, never, never> =>
  Effect.gen(function* () {
    const execution = yield* makeExecutionInspectorCollector()
    const filesystem = yield* makeFilesystemInspectorCollector()
    const nativeHost = yield* makeNativeHostInspectorCollector()
    const persistence = yield* makePersistenceInspectorCollector()
    const workflow = yield* makeWorkflowInspectorCollector()
    const eventLog = yield* makeEventLogInspectorCollector()
    const renderer = yield* makeRendererInspectorCollector()

    return Object.freeze({
      execution,
      filesystem,
      nativeHost,
      persistence,
      workflow,
      eventLog,
      renderer,
      events: Stream.mergeAll(
        [
          execution.events.pipe(
            Stream.map((event) => new InspectorEvent({ channel: "execution", execution: event }))
          ),
          filesystem.events.pipe(
            Stream.map((event) => new InspectorEvent({ channel: "filesystem", filesystem: event }))
          ),
          nativeHost.events.pipe(
            Stream.map((event) => new InspectorEvent({ channel: "native-host", nativeHost: event }))
          ),
          persistence.events.pipe(
            Stream.map(
              (event) => new InspectorEvent({ channel: "persistence", persistence: event })
            )
          ),
          workflow.events.pipe(
            Stream.map((event) => new InspectorEvent({ channel: "workflow", workflow: event }))
          ),
          eventLog.events.pipe(
            Stream.map((event) => new InspectorEvent({ channel: "event-log", eventLog: event }))
          ),
          renderer.events.pipe(
            Stream.map((event) => new InspectorEvent({ channel: "renderer", renderer: event }))
          )
        ],
        { concurrency: 7 }
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

export const PersistenceInspectorCollectorLive: Layer.Layer<
  PersistenceInspectorCollector,
  never,
  never
> = Layer.effect(PersistenceInspectorCollector, makePersistenceInspectorCollector())

export const WorkflowInspectorCollectorLive: Layer.Layer<WorkflowInspectorCollector, never, never> =
  Layer.effect(WorkflowInspectorCollector, makeWorkflowInspectorCollector())

export const EventLogInspectorCollectorLive: Layer.Layer<EventLogInspectorCollector, never, never> =
  Layer.effect(EventLogInspectorCollector, makeEventLogInspectorCollector())

export const RendererInspectorCollectorLive: Layer.Layer<RendererInspectorCollector, never, never> =
  Layer.effect(RendererInspectorCollector, makeRendererInspectorCollector())

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

export const InspectorPersistenceEvents = Rpc.make("Inspector.events.persistence", {
  success: PersistenceInspectorEvent,
  error: Schema.Never,
  stream: true
}).pipe(BridgeRuntime({ backpressure: { strategy: "drop", size: 1024 } }))

export const InspectorWorkflowEvents = Rpc.make("Inspector.events.workflow", {
  success: WorkflowInspectorEvent,
  error: Schema.Never,
  stream: true
}).pipe(BridgeRuntime({ backpressure: { strategy: "drop", size: 1024 } }))

export const InspectorEventLogEvents = Rpc.make("Inspector.events.eventLog", {
  success: EventLogInspectorEvent,
  error: Schema.Never,
  stream: true
}).pipe(BridgeRuntime({ backpressure: { strategy: "drop", size: 1024 } }))

export const InspectorRendererEvents = Rpc.make("Inspector.events.renderer", {
  success: RendererInspectorEvent,
  error: Schema.Never,
  stream: true
}).pipe(BridgeRuntime({ backpressure: { strategy: "drop", size: 1024 } }))

export const InspectorEventRpcs = RpcGroup.make(
  InspectorExecutionEvents,
  InspectorFilesystemEvents,
  InspectorNativeHostEvents,
  InspectorPersistenceEvents,
  InspectorWorkflowEvents,
  InspectorEventLogEvents,
  InspectorRendererEvents
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

export const disabledPersistenceInspectorCollector: PersistenceInspectorCollectorApi =
  Object.freeze({
    publish: () => Effect.void,
    events: Stream.empty
  })

export const disabledWorkflowInspectorCollector: WorkflowInspectorCollectorApi = Object.freeze({
  publish: () => Effect.void,
  events: Stream.empty
})

export const disabledEventLogInspectorCollector: EventLogInspectorCollectorApi = Object.freeze({
  publish: () => Effect.void,
  events: Stream.empty
})

export const disabledRendererInspectorCollector: RendererInspectorCollectorApi = Object.freeze({
  publish: () => Effect.void,
  events: Stream.empty
})
