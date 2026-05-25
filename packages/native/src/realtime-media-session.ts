import {
  type BridgeClientExchange,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  type RpcCapabilityMetadata,
  type RpcSupportMetadata,
  RpcGroup,
  type HostProtocolError
} from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Context, Effect, Layer, PubSub, Schema, Stream } from "effect"

import { decodeNativeInput, runNativeRpc, runNativeRpcStream } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
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
const StartupUnverifiedSupportReason = "host-media-startup-unverified"
const MacOsRealtimeMediaSessionSupport = NativeSurface.support.partial(
  StartupUnverifiedSupportReason,
  {
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported", reason: StartupUnverifiedSupportReason },
      { platform: "linux", status: "unsupported", reason: StartupUnverifiedSupportReason }
    ]
  }
) satisfies RpcSupportMetadata

export type RealtimeMediaSessionError = HostProtocolError

export const RealtimeMediaSessionOpen = realtimeMediaSessionRpc(
  "open",
  RealtimeMediaSessionOpenInput,
  Schema.Void,
  P.nativeInvoke({ primitive: Surface, methods: ["open"] }),
  MacOsRealtimeMediaSessionSupport
)
export const RealtimeMediaSessionClose = realtimeMediaSessionRpc(
  "close",
  RealtimeMediaSessionIdentity,
  Schema.Void,
  P.nativeInvoke({ primitive: Surface, methods: ["close"] }),
  MacOsRealtimeMediaSessionSupport
)
export const RealtimeMediaSessionSelectDevice = realtimeMediaSessionRpc(
  "selectDevice",
  RealtimeMediaSessionSelectDeviceInput,
  Schema.Void,
  P.nativeInvoke({ primitive: Surface, methods: ["selectDevice"] }),
  MacOsRealtimeMediaSessionSupport
)
export const RealtimeMediaSessionInterrupt = realtimeMediaSessionRpc(
  "interrupt",
  RealtimeMediaSessionInterruptInput,
  Schema.Void,
  P.nativeInvoke({ primitive: Surface, methods: ["interrupt"] }),
  MacOsRealtimeMediaSessionSupport
)
export const RealtimeMediaSessionIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: RealtimeMediaSessionSupportedOutput,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const RealtimeMediaDeviceState = NativeSurface.event(Surface, "DeviceState", {
  payload: RealtimeMediaDeviceStateEvent,
  support: MacOsRealtimeMediaSessionSupport
})

const RealtimeMediaPermissionState = NativeSurface.event(Surface, "PermissionState", {
  payload: RealtimeMediaPermissionStateEvent,
  support: MacOsRealtimeMediaSessionSupport
})

const RealtimeMediaInterruption = NativeSurface.event(Surface, "Interruption", {
  payload: RealtimeMediaInterruptionEvent,
  support: MacOsRealtimeMediaSessionSupport
})

const RealtimeMediaSessionState = NativeSurface.event(Surface, "SessionState", {
  payload: RealtimeMediaSessionStateEvent,
  support: MacOsRealtimeMediaSessionSupport
})

const RealtimeMediaSessionRpcGroup = RpcGroup.make(
  RealtimeMediaSessionOpen,
  RealtimeMediaSessionClose,
  RealtimeMediaSessionSelectDevice,
  RealtimeMediaSessionInterrupt,
  RealtimeMediaSessionIsSupported,
  RealtimeMediaDeviceState,
  RealtimeMediaPermissionState,
  RealtimeMediaInterruption,
  RealtimeMediaSessionState
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
    input?: RealtimeMediaSessionIdentity
  ) => Stream.Stream<RealtimeMediaSessionEvent, RealtimeMediaSessionError, never>
}

export class RealtimeMediaSessionClient extends Context.Service<
  RealtimeMediaSessionClient,
  RealtimeMediaSessionClientApi
>()("@orika/native/RealtimeMediaSessionClient") {}

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
    input?: RealtimeMediaSessionIdentity
  ) => Stream.Stream<RealtimeMediaSessionEvent, RealtimeMediaSessionError, never>
}

export class RealtimeMediaSession extends Context.Service<
  RealtimeMediaSession,
  RealtimeMediaSessionServiceApi
>()("@orika/native/RealtimeMediaSession") {
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

export type RealtimeMediaSessionRpc = RpcGroup.Rpcs<typeof RealtimeMediaSessionRpcGroup>

export type RealtimeMediaSessionRpcHandlers<R = never> = NativeRpcHandlers<
  typeof RealtimeMediaSessionRpcGroup,
  R
>

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
    }),
  "RealtimeMediaSession.events.DeviceState": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const media = yield* RealtimeMediaSession
        return media.events().pipe(Stream.filter(isRealtimeMediaDeviceStateEvent))
      })
    ),
  "RealtimeMediaSession.events.PermissionState": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const media = yield* RealtimeMediaSession
        return media.events().pipe(Stream.filter(isRealtimeMediaPermissionStateEvent))
      })
    ),
  "RealtimeMediaSession.events.Interruption": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const media = yield* RealtimeMediaSession
        return media.events().pipe(Stream.filter(isRealtimeMediaInterruptionEvent))
      })
    ),
  "RealtimeMediaSession.events.SessionState": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const media = yield* RealtimeMediaSession
        return media.events().pipe(Stream.filter(isRealtimeMediaSessionStateEvent))
      })
    )
})

export const RealtimeMediaSessionSurface = NativeSurface.make(
  Surface,
  RealtimeMediaSessionRpcGroup,
  {
    service: RealtimeMediaSessionClient,
    capabilities: RealtimeMediaSessionCapabilityMethods,
    handlers: RealtimeMediaSessionHandlersLive,
    client: (client) => realtimeMediaSessionClientFromRpcClient(client),
    bridgeClient: (client, exchange) =>
      realtimeMediaSessionBridgeClientFromRpcClient(client, exchange)
  }
)

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
        input === undefined
          ? Stream.fromPubSub(pubsub)
          : Stream.unwrap(
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
      input === undefined
        ? Stream.fail(unsupportedError("RealtimeMediaSession.events"))
        : Stream.unwrap(
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
  client: DesktopRpcClient<RealtimeMediaSessionRpc>
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
      filterRealtimeMediaSessionEvents(realtimeMediaSessionEventStreams(client), input)
  } satisfies RealtimeMediaSessionClientApi)

const realtimeMediaSessionBridgeClientFromRpcClient = (
  client: DesktopRpcClient<RealtimeMediaSessionRpc>,
  exchange: BridgeClientExchange
): RealtimeMediaSessionClientApi =>
  Object.freeze({
    ...realtimeMediaSessionClientFromRpcClient(client),
    events: (input) =>
      filterRealtimeMediaSessionEvents(
        Stream.unwrap(
          runRealtimeMediaSessionRpc(
            client["RealtimeMediaSession.isSupported"](undefined),
            "RealtimeMediaSession.isSupported"
          ).pipe(
            Effect.map((support) => {
              if (!support.supported) {
                return Stream.fail(
                  unsupportedError(
                    "RealtimeMediaSession.events",
                    support.reason ?? UnsupportedReason
                  )
                )
              }
              return subscribeRealtimeMediaSessionEvent(exchange)
            })
          )
        ),
        input
      )
  } satisfies RealtimeMediaSessionClientApi)

const filterRealtimeMediaSessionEvents = (
  stream: Stream.Stream<RealtimeMediaSessionEvent, RealtimeMediaSessionError, never>,
  input: RealtimeMediaSessionIdentity | undefined
): Stream.Stream<RealtimeMediaSessionEvent, RealtimeMediaSessionError, never> => {
  if (input === undefined) {
    return stream
  }

  return Stream.unwrap(
    validateRealtimeMediaSessionIdentity(input, "RealtimeMediaSession.events").pipe(
      Effect.map((valid) =>
        stream.pipe(
          Stream.filter(
            (event) => event.profileId === valid.profileId && event.sessionId === valid.sessionId
          )
        )
      )
    )
  )
}

const realtimeMediaSessionEventStreams = (
  client: DesktopRpcClient<RealtimeMediaSessionRpc>
): Stream.Stream<RealtimeMediaSessionEvent, RealtimeMediaSessionError, never> => {
  const asEvent = <A extends RealtimeMediaSessionEvent>(
    stream: Stream.Stream<A, RealtimeMediaSessionError, never>
  ): Stream.Stream<RealtimeMediaSessionEvent, RealtimeMediaSessionError, never> => stream

  return Stream.mergeAll(
    [
      asEvent(
        runRealtimeMediaSessionRpcStream(
          client["RealtimeMediaSession.events.DeviceState"](undefined),
          "RealtimeMediaSession.events.DeviceState"
        )
      ),
      asEvent(
        runRealtimeMediaSessionRpcStream(
          client["RealtimeMediaSession.events.PermissionState"](undefined),
          "RealtimeMediaSession.events.PermissionState"
        )
      ),
      asEvent(
        runRealtimeMediaSessionRpcStream(
          client["RealtimeMediaSession.events.Interruption"](undefined),
          "RealtimeMediaSession.events.Interruption"
        )
      ),
      asEvent(
        runRealtimeMediaSessionRpcStream(
          client["RealtimeMediaSession.events.SessionState"](undefined),
          "RealtimeMediaSession.events.SessionState"
        )
      )
    ],
    { concurrency: "unbounded" }
  )
}

const subscribeRealtimeMediaSessionEvent = (
  exchange: BridgeClientExchange
): Stream.Stream<RealtimeMediaSessionEvent, RealtimeMediaSessionError, never> => {
  const asEvent = <A extends RealtimeMediaSessionEvent>(
    stream: Stream.Stream<A, RealtimeMediaSessionError, never>
  ): Stream.Stream<RealtimeMediaSessionEvent, RealtimeMediaSessionError, never> => stream

  return Stream.mergeAll(
    [
      asEvent(NativeSurface.subscribeEvent(exchange, RealtimeMediaDeviceState)),
      asEvent(NativeSurface.subscribeEvent(exchange, RealtimeMediaPermissionState)),
      asEvent(NativeSurface.subscribeEvent(exchange, RealtimeMediaInterruption)),
      asEvent(NativeSurface.subscribeEvent(exchange, RealtimeMediaSessionState))
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

const unsupportedError = (
  operation: string,
  reason: string = UnsupportedReason
): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason,
    message: `unsupported RealtimeMediaSession method: ${operation}`,
    operation,
    recoverable: false
  })

function realtimeMediaSessionRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(
  method: Method,
  payload: Payload,
  success: Success,
  capability: RpcCapabilityMetadata,
  support: RpcSupportMetadata
) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support
  })
}

const runRealtimeMediaSessionRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, RealtimeMediaSessionError, never> => runNativeRpc(effect, operation, Surface)

const runRealtimeMediaSessionRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  operation: string
): Stream.Stream<A, RealtimeMediaSessionError, never> =>
  runNativeRpcStream(stream, operation, Surface)

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
