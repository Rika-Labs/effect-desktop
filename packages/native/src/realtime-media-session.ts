import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeDesktopClientProtocol,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { type DesktopRpcClient, type PermissionRegistry, P } from "@effect-desktop/core"
import { Context, Effect, Layer, PubSub, Schema, Stream } from "effect"
import { RpcClient } from "effect/unstable/rpc"

import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import {
  RealtimeMediaDeviceStateEvent,
  RealtimeMediaInterruptionEvent,
  RealtimeMediaPermissionStateEvent,
  type RealtimeMediaSessionEvent,
  RealtimeMediaSessionIdentity,
  RealtimeMediaSessionInterruptInput,
  RealtimeMediaSessionOpenInput,
  RealtimeMediaSessionSelectDeviceInput,
  RealtimeMediaSessionStateEvent,
  RealtimeMediaSessionSupportedOutput,
  RealtimeMediaSessionSupportedResult
} from "./contracts/realtime-media-session.js"

const Surface = "RealtimeMediaSession"
const UnsupportedReason = "host-adapter-unimplemented"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type RealtimeMediaSessionError = HostProtocolError

export const RealtimeMediaSessionOpen = realtimeMediaSessionRpc(
  "open",
  RealtimeMediaSessionOpenInput,
  Schema.Void,
  P.nativeInvoke({ primitive: Surface, methods: ["open"] })
)
export const RealtimeMediaSessionClose = realtimeMediaSessionRpc(
  "close",
  RealtimeMediaSessionIdentity,
  Schema.Void,
  P.nativeInvoke({ primitive: Surface, methods: ["close"] })
)
export const RealtimeMediaSessionSelectDevice = realtimeMediaSessionRpc(
  "selectDevice",
  RealtimeMediaSessionSelectDeviceInput,
  Schema.Void,
  P.nativeInvoke({ primitive: Surface, methods: ["selectDevice"] })
)
export const RealtimeMediaSessionInterrupt = realtimeMediaSessionRpc(
  "interrupt",
  RealtimeMediaSessionInterruptInput,
  Schema.Void,
  P.nativeInvoke({ primitive: Surface, methods: ["interrupt"] })
)
export const RealtimeMediaSessionIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: RealtimeMediaSessionSupportedOutput,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const RealtimeMediaSessionRpcEvents = Object.freeze({
  DeviceState: { payload: RealtimeMediaDeviceStateEvent },
  PermissionState: { payload: RealtimeMediaPermissionStateEvent },
  Interruption: { payload: RealtimeMediaInterruptionEvent },
  SessionState: { payload: RealtimeMediaSessionStateEvent }
})

export type RealtimeMediaSessionRpcEvents = typeof RealtimeMediaSessionRpcEvents

const RealtimeMediaSessionRpcGroup = RpcGroup.make(
  RealtimeMediaSessionOpen,
  RealtimeMediaSessionClose,
  RealtimeMediaSessionSelectDevice,
  RealtimeMediaSessionInterrupt,
  RealtimeMediaSessionIsSupported
)

export const RealtimeMediaSessionRpcs: RpcGroup.RpcGroup<RealtimeMediaSessionRpc> =
  RealtimeMediaSessionRpcGroup

export const RealtimeMediaSessionMethodNames = Object.freeze([
  "open",
  "close",
  "selectDevice",
  "interrupt",
  "isSupported"
] as const)

const RealtimeMediaSessionCapabilityMethods = Object.freeze([
  "open",
  "close",
  "selectDevice",
  "interrupt"
] as const satisfies readonly (typeof RealtimeMediaSessionMethodNames)[number][])

export interface RealtimeMediaSessionClientApi {
  readonly open: (
    input: RealtimeMediaSessionOpenInput
  ) => Effect.Effect<void, RealtimeMediaSessionError, never>
  readonly close: (
    input: RealtimeMediaSessionIdentity
  ) => Effect.Effect<void, RealtimeMediaSessionError, never>
  readonly selectDevice: (
    input: RealtimeMediaSessionSelectDeviceInput
  ) => Effect.Effect<void, RealtimeMediaSessionError, never>
  readonly interrupt: (
    input: RealtimeMediaSessionInterruptInput
  ) => Effect.Effect<void, RealtimeMediaSessionError, never>
  readonly isSupported: () => Effect.Effect<
    RealtimeMediaSessionSupportedResult,
    RealtimeMediaSessionError,
    never
  >
  readonly events: (
    input: RealtimeMediaSessionIdentity
  ) => Stream.Stream<RealtimeMediaSessionEvent, RealtimeMediaSessionError, never>
}

export class RealtimeMediaSessionClient extends Context.Service<
  RealtimeMediaSessionClient,
  RealtimeMediaSessionClientApi
>()("@effect-desktop/native/RealtimeMediaSessionClient") {}

export interface RealtimeMediaSessionServiceApi extends Omit<
  RealtimeMediaSessionClientApi,
  "events"
> {
  readonly deviceState: (
    input: RealtimeMediaSessionIdentity
  ) => Stream.Stream<RealtimeMediaDeviceStateEvent, RealtimeMediaSessionError, never>
  readonly permissionState: (
    input: RealtimeMediaSessionIdentity
  ) => Stream.Stream<RealtimeMediaPermissionStateEvent, RealtimeMediaSessionError, never>
  readonly interruptions: (
    input: RealtimeMediaSessionIdentity
  ) => Stream.Stream<RealtimeMediaInterruptionEvent, RealtimeMediaSessionError, never>
  readonly sessionState: (
    input: RealtimeMediaSessionIdentity
  ) => Stream.Stream<RealtimeMediaSessionStateEvent, RealtimeMediaSessionError, never>
  readonly events: (
    input: RealtimeMediaSessionIdentity
  ) => Stream.Stream<RealtimeMediaSessionEvent, RealtimeMediaSessionError, never>
}

export class RealtimeMediaSession extends Context.Service<
  RealtimeMediaSession,
  RealtimeMediaSessionServiceApi
>()("@effect-desktop/native/RealtimeMediaSession") {
  static readonly layer = Layer.effect(RealtimeMediaSession)(
    Effect.gen(function* () {
      const client = yield* RealtimeMediaSessionClient
      return RealtimeMediaSession.of({
        open: (input) => client.open(input),
        close: (input) => client.close(input),
        selectDevice: (input) => client.selectDevice(input),
        interrupt: (input) => client.interrupt(input),
        isSupported: () => client.isSupported(),
        deviceState: (input) =>
          client.events(input).pipe(Stream.filter(isRealtimeMediaDeviceStateEvent)),
        permissionState: (input) =>
          client.events(input).pipe(Stream.filter(isRealtimeMediaPermissionStateEvent)),
        interruptions: (input) =>
          client.events(input).pipe(Stream.filter(isRealtimeMediaInterruptionEvent)),
        sessionState: (input) =>
          client.events(input).pipe(Stream.filter(isRealtimeMediaSessionStateEvent)),
        events: (input) => client.events(input)
      } satisfies RealtimeMediaSessionServiceApi)
    })
  )
}

export const RealtimeMediaSessionLive = RealtimeMediaSession.layer

export const makeRealtimeMediaSessionClientLayer = (
  client: RealtimeMediaSessionClientApi
): Layer.Layer<RealtimeMediaSessionClient> => Layer.succeed(RealtimeMediaSessionClient)(client)

export const makeRealtimeMediaSessionServiceLayer = (
  client: RealtimeMediaSessionClientApi
): Layer.Layer<RealtimeMediaSession> =>
  Layer.provide(RealtimeMediaSessionLive, makeRealtimeMediaSessionClientLayer(client))

export const makeRealtimeMediaSessionBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<RealtimeMediaSessionClient> =>
  Layer.effect(
    RealtimeMediaSessionClient,
    RpcClient.make(RealtimeMediaSessionRpcGroup).pipe(
      Effect.map((client) => realtimeMediaSessionClientFromRpcClient(client, exchange))
    )
  ).pipe(Layer.provide(makeRealtimeMediaSessionBridgeProtocolLayer(exchange, options)))

export type RealtimeMediaSessionRpc = RpcGroup.Rpcs<typeof RealtimeMediaSessionRpcGroup>

export type RealtimeMediaSessionRpcHandlers = RpcGroup.HandlersFrom<RealtimeMediaSessionRpc>

export const RealtimeMediaSessionHandlersLive = RealtimeMediaSessionRpcGroup.toLayer({
  "RealtimeMediaSession.open": (input) =>
    Effect.gen(function* () {
      const media = yield* RealtimeMediaSession
      yield* media.open(input)
    }),
  "RealtimeMediaSession.close": (input) =>
    Effect.gen(function* () {
      const media = yield* RealtimeMediaSession
      yield* media.close(input)
    }),
  "RealtimeMediaSession.selectDevice": (input) =>
    Effect.gen(function* () {
      const media = yield* RealtimeMediaSession
      yield* media.selectDevice(input)
    }),
  "RealtimeMediaSession.interrupt": (input) =>
    Effect.gen(function* () {
      const media = yield* RealtimeMediaSession
      yield* media.interrupt(input)
    }),
  "RealtimeMediaSession.isSupported": () =>
    Effect.gen(function* () {
      const media = yield* RealtimeMediaSession
      return yield* media.isSupported()
    })
})

export const RealtimeMediaSessionSurface = NativeSurface.make(
  Surface,
  RealtimeMediaSessionRpcGroup,
  {
    service: RealtimeMediaSessionClient,
    capabilities: RealtimeMediaSessionCapabilityMethods,
    handlers: RealtimeMediaSessionHandlersLive,
    client: (client) => realtimeMediaSessionClientFromRpcClient(client, undefined)
  }
)

export const makeHostRealtimeMediaSessionRpcRuntime = (
  handlers: RealtimeMediaSessionRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  RealtimeMediaSessionSurface.hostRuntime(handlers, runtimeOptions)

export interface RealtimeMediaSessionMemoryClientOptions {
  readonly failure?: Partial<
    Record<"open" | "close" | "selectDevice" | "interrupt", RealtimeMediaSessionError>
  >
}

export const makeRealtimeMediaSessionMemoryClient = (
  options: RealtimeMediaSessionMemoryClientOptions = {}
): Effect.Effect<RealtimeMediaSessionClientApi, never, never> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.bounded<RealtimeMediaSessionEvent>({ capacity: 256, replay: 64 })

    const publish = (event: RealtimeMediaSessionEvent): Effect.Effect<void, never, never> =>
      PubSub.publish(pubsub, event).pipe(Effect.asVoid)

    return Object.freeze({
      open: (input) =>
        validateRealtimeMediaSessionOpenInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.open,
              publish(
                new RealtimeMediaSessionStateEvent({
                  profileId: valid.profileId,
                  sessionId: valid.sessionId,
                  type: "session-state",
                  state: "active"
                })
              )
            )
          )
        ),
      close: (input) =>
        validateRealtimeMediaSessionIdentity(input, "RealtimeMediaSession.close").pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.close,
              publish(
                new RealtimeMediaSessionStateEvent({
                  profileId: valid.profileId,
                  sessionId: valid.sessionId,
                  type: "session-state",
                  state: "closed"
                })
              )
            )
          )
        ),
      selectDevice: (input) =>
        validateRealtimeMediaSessionSelectDeviceInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.selectDevice,
              publish(
                new RealtimeMediaDeviceStateEvent({
                  type: "device-state",
                  profileId: valid.profileId,
                  sessionId: valid.sessionId,
                  devices: [
                    {
                      kind: valid.kind,
                      deviceId: valid.deviceId,
                      label: valid.deviceId,
                      selected: true,
                      available: true
                    }
                  ]
                })
              )
            )
          )
        ),
      interrupt: (input) =>
        validateRealtimeMediaSessionInterruptInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.interrupt,
              publish(
                new RealtimeMediaInterruptionEvent({
                  type: "interruption",
                  profileId: valid.profileId,
                  sessionId: valid.sessionId,
                  reason: valid.reason
                })
              )
            )
          )
        ),
      isSupported: () =>
        Effect.succeed(
          new RealtimeMediaSessionSupportedResult({
            supported: false,
            reason: UnsupportedReason
          })
        ),
      events: (input) =>
        Stream.unwrap(
          validateRealtimeMediaSessionIdentity(input, "RealtimeMediaSession.events").pipe(
            Effect.map((valid) =>
              Stream.fromPubSub(pubsub).pipe(
                Stream.filter(
                  (event) =>
                    event.profileId === valid.profileId && event.sessionId === valid.sessionId
                )
              )
            )
          )
        )
    } satisfies RealtimeMediaSessionClientApi)
  })

export const makeRealtimeMediaSessionUnsupportedClient = (): RealtimeMediaSessionClientApi =>
  Object.freeze({
    open: (input) =>
      validateRealtimeMediaSessionOpenInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("RealtimeMediaSession.open")))
      ),
    close: (input) =>
      validateRealtimeMediaSessionIdentity(input, "RealtimeMediaSession.close").pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("RealtimeMediaSession.close")))
      ),
    selectDevice: (input) =>
      validateRealtimeMediaSessionSelectDeviceInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("RealtimeMediaSession.selectDevice")))
      ),
    interrupt: (input) =>
      validateRealtimeMediaSessionInterruptInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("RealtimeMediaSession.interrupt")))
      ),
    isSupported: () =>
      Effect.succeed(
        new RealtimeMediaSessionSupportedResult({
          supported: false,
          reason: UnsupportedReason
        })
      ),
    events: (input) =>
      Stream.unwrap(
        validateRealtimeMediaSessionIdentity(input, "RealtimeMediaSession.events").pipe(
          Effect.map(() => Stream.fail(unsupportedError("RealtimeMediaSession.events")))
        )
      )
  } satisfies RealtimeMediaSessionClientApi)

export const makeRealtimeMediaSessionPermissionDeniedError = (
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability: "native.invoke",
    message: `permission denied for ${operation}`,
    operation,
    recoverable: false
  })

const realtimeMediaSessionClientFromRpcClient = (
  client: DesktopRpcClient<RealtimeMediaSessionRpc>,
  exchange: BridgeClientExchange | undefined
): RealtimeMediaSessionClientApi =>
  Object.freeze({
    open: (input) =>
      validateRealtimeMediaSessionOpenInput(input).pipe(
        Effect.flatMap((validated) =>
          runRealtimeMediaSessionRpc(
            client["RealtimeMediaSession.open"](validated),
            "RealtimeMediaSession.open"
          )
        )
      ),
    close: (input) =>
      validateRealtimeMediaSessionIdentity(input, "RealtimeMediaSession.close").pipe(
        Effect.flatMap((validated) =>
          runRealtimeMediaSessionRpc(
            client["RealtimeMediaSession.close"](validated),
            "RealtimeMediaSession.close"
          )
        )
      ),
    selectDevice: (input) =>
      validateRealtimeMediaSessionSelectDeviceInput(input).pipe(
        Effect.flatMap((validated) =>
          runRealtimeMediaSessionRpc(
            client["RealtimeMediaSession.selectDevice"](validated),
            "RealtimeMediaSession.selectDevice"
          )
        )
      ),
    interrupt: (input) =>
      validateRealtimeMediaSessionInterruptInput(input).pipe(
        Effect.flatMap((validated) =>
          runRealtimeMediaSessionRpc(
            client["RealtimeMediaSession.interrupt"](validated),
            "RealtimeMediaSession.interrupt"
          )
        )
      ),
    isSupported: () =>
      runRealtimeMediaSessionRpc(
        client["RealtimeMediaSession.isSupported"](undefined),
        "RealtimeMediaSession.isSupported"
      ),
    events: (input) =>
      Stream.unwrap(
        validateRealtimeMediaSessionIdentity(input, "RealtimeMediaSession.events").pipe(
          Effect.map((valid) =>
            subscribeRealtimeMediaSessionEvent(exchange).pipe(
              Stream.filter(
                (event) =>
                  event.profileId === valid.profileId && event.sessionId === valid.sessionId
              )
            )
          )
        )
      )
  } satisfies RealtimeMediaSessionClientApi)

const makeRealtimeMediaSessionBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const subscribeRealtimeMediaSessionEvent = (
  exchange: BridgeClientExchange | undefined
): Stream.Stream<RealtimeMediaSessionEvent, RealtimeMediaSessionError, never> => {
  const asEvent = <A extends RealtimeMediaSessionEvent>(
    stream: Stream.Stream<A, RealtimeMediaSessionError, never>
  ): Stream.Stream<RealtimeMediaSessionEvent, RealtimeMediaSessionError, never> => stream

  return Stream.mergeAll(
    [
      asEvent(
        subscribeNativeEvent(
          exchange,
          "RealtimeMediaSession.DeviceState",
          RealtimeMediaDeviceStateEvent
        )
      ),
      asEvent(
        subscribeNativeEvent(
          exchange,
          "RealtimeMediaSession.PermissionState",
          RealtimeMediaPermissionStateEvent
        )
      ),
      asEvent(
        subscribeNativeEvent(
          exchange,
          "RealtimeMediaSession.Interruption",
          RealtimeMediaInterruptionEvent
        )
      ),
      asEvent(
        subscribeNativeEvent(
          exchange,
          "RealtimeMediaSession.SessionState",
          RealtimeMediaSessionStateEvent
        )
      )
    ],
    { concurrency: "unbounded" }
  )
}

const validateRealtimeMediaSessionOpenInput = (
  input: unknown
): Effect.Effect<RealtimeMediaSessionOpenInput, RealtimeMediaSessionError, never> =>
  decodeNativeInput(RealtimeMediaSessionOpenInput, input, "RealtimeMediaSession.open")

const validateRealtimeMediaSessionIdentity = (
  input: unknown,
  operation: string
): Effect.Effect<RealtimeMediaSessionIdentity, RealtimeMediaSessionError, never> =>
  decodeNativeInput(RealtimeMediaSessionIdentity, input, operation)

const validateRealtimeMediaSessionSelectDeviceInput = (
  input: unknown
): Effect.Effect<RealtimeMediaSessionSelectDeviceInput, RealtimeMediaSessionError, never> =>
  decodeNativeInput(
    RealtimeMediaSessionSelectDeviceInput,
    input,
    "RealtimeMediaSession.selectDevice"
  )

const validateRealtimeMediaSessionInterruptInput = (
  input: unknown
): Effect.Effect<RealtimeMediaSessionInterruptInput, RealtimeMediaSessionError, never> =>
  decodeNativeInput(RealtimeMediaSessionInterruptInput, input, "RealtimeMediaSession.interrupt")

const failOr = <A>(
  error: RealtimeMediaSessionError | undefined,
  effect: Effect.Effect<A, never, never>
): Effect.Effect<A, RealtimeMediaSessionError, never> =>
  error === undefined ? effect : Effect.fail(error)

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported RealtimeMediaSession method: ${operation}`,
    operation,
    recoverable: false
  })

function realtimeMediaSessionRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: UnsupportedSupport
  })
}

const runRealtimeMediaSessionRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, RealtimeMediaSessionError, never> => runNativeRpc(effect, operation, Surface)

const isRealtimeMediaDeviceStateEvent = (
  event: RealtimeMediaSessionEvent
): event is RealtimeMediaDeviceStateEvent => event.type === "device-state"

const isRealtimeMediaPermissionStateEvent = (
  event: RealtimeMediaSessionEvent
): event is RealtimeMediaPermissionStateEvent => event.type === "permission-state"

const isRealtimeMediaInterruptionEvent = (
  event: RealtimeMediaSessionEvent
): event is RealtimeMediaInterruptionEvent => event.type === "interruption"

const isRealtimeMediaSessionStateEvent = (
  event: RealtimeMediaSessionEvent
): event is RealtimeMediaSessionStateEvent => event.type === "session-state"
