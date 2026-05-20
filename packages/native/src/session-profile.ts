import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  HostProtocolUnsupportedError,
  RpcGroup
} from "@effect-desktop/bridge"
import { type DesktopRpcClient, P, type PermissionRegistry } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { SessionProfileEvent, SessionProfileSupportedResult } from "./contracts/session-profile.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/session-profile.js"

const Surface = "SessionProfile"
const UnsupportedReason = "host-session-profile-routing-unavailable"
const EventMethod = "SessionProfile.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type SessionProfileError = HostProtocolError

export const SessionProfileIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: SessionProfileSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const sessionProfileCapabilityFact = (method: "fromPartition" | "destroy" | "list") =>
  NativeSurface.capabilityFact(Surface, method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: [method] })
    ),
    support: UnsupportedSupport
  })

export const SessionProfileCapabilityFacts = Object.freeze([
  sessionProfileCapabilityFact("fromPartition"),
  sessionProfileCapabilityFact("destroy"),
  sessionProfileCapabilityFact("list")
])

export const SessionProfileRpcEvents = Object.freeze({
  Event: { payload: SessionProfileEvent }
})

const SessionProfileRpcGroup = RpcGroup.make(SessionProfileIsSupported)

export const SessionProfileRpcs: RpcGroup.RpcGroup<SessionProfileRpc> = SessionProfileRpcGroup

export const SessionProfileMethodNames = Object.freeze(["isSupported"] as const)

export interface SessionProfileClientApi {
  readonly isSupported: () => Effect.Effect<
    SessionProfileSupportedResult,
    SessionProfileError,
    never
  >
  readonly events: () => Stream.Stream<SessionProfileEvent, SessionProfileError, never>
}

export class SessionProfileClient extends Context.Service<
  SessionProfileClient,
  SessionProfileClientApi
>()("@effect-desktop/native/SessionProfileClient") {}

export interface SessionProfileServiceApi {
  readonly isSupported: () => Effect.Effect<
    SessionProfileSupportedResult,
    SessionProfileError,
    never
  >
  readonly events: () => Stream.Stream<SessionProfileEvent, SessionProfileError, never>
}

export class SessionProfile extends Context.Service<SessionProfile, SessionProfileServiceApi>()(
  "@effect-desktop/native/SessionProfile"
) {
  static readonly layer = Layer.effect(SessionProfile)(
    Effect.gen(function* () {
      const client = yield* SessionProfileClient
      return makeSessionProfileService(client)
    })
  )
}

export const SessionProfileLive = SessionProfile.layer

export const makeSessionProfileClientLayer = (
  client: SessionProfileClientApi
): Layer.Layer<SessionProfileClient> => Layer.succeed(SessionProfileClient)(client)

export const makeSessionProfileServiceLayer = (
  client: SessionProfileClientApi
): Layer.Layer<SessionProfile> => Layer.succeed(SessionProfile)(makeSessionProfileService(client))

export const makeSessionProfileBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<SessionProfileClient> => SessionProfileSurface.bridgeClientLayer(exchange, options)

export type SessionProfileRpc = RpcGroup.Rpcs<typeof SessionProfileRpcGroup>
export type SessionProfileRpcHandlers = RpcGroup.HandlersFrom<SessionProfileRpc>

export const SessionProfileHandlersLive = SessionProfileRpcGroup.toLayer({
  "SessionProfile.isSupported": () =>
    Effect.gen(function* () {
      const profiles = yield* SessionProfile
      return yield* profiles.isSupported()
    })
})

export const SessionProfileSurface = NativeSurface.make(Surface, SessionProfileRpcGroup, {
  service: SessionProfileClient,
  handlers: SessionProfileHandlersLive,
  capabilityFacts: SessionProfileCapabilityFacts,
  client: (client) => sessionProfileClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => sessionProfileClientFromRpcClient(client, exchange)
})

export const makeHostSessionProfileRpcRuntime = (
  handlers: SessionProfileRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  SessionProfileSurface.hostRuntime(handlers, runtimeOptions)

export const makeSessionProfileMemoryClient = (): Effect.Effect<
  SessionProfileClientApi,
  never,
  never
> =>
  Effect.succeed(
    Object.freeze({
      isSupported: () => Effect.succeed(new SessionProfileSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies SessionProfileClientApi)
  )

export const makeSessionProfileUnsupportedClient = (): SessionProfileClientApi =>
  Object.freeze({
    isSupported: () =>
      Effect.succeed(
        new SessionProfileSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies SessionProfileClientApi)

const makeSessionProfileService = (client: SessionProfileClientApi): SessionProfileServiceApi =>
  Object.freeze({
    isSupported: () => client.isSupported(),
    events: () => client.events()
  } satisfies SessionProfileServiceApi)

const sessionProfileClientFromRpcClient = (
  client: DesktopRpcClient<SessionProfileRpc>,
  exchange: BridgeClientExchange | undefined
): SessionProfileClientApi =>
  Object.freeze({
    isSupported: () =>
      runSessionProfileRpc(
        client["SessionProfile.isSupported"](undefined),
        "SessionProfile.isSupported"
      ),
    events: () => subscribeNativeEvent(exchange, EventMethod, SessionProfileEvent)
  } satisfies SessionProfileClientApi)

const runSessionProfileRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, SessionProfileError, never> => runNativeRpc(effect, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: UnsupportedReason,
    operation,
    recoverable: false
  })
