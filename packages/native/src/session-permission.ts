import {
  type BridgeClientExchange,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  HostProtocolUnsupportedError,
  RpcGroup
} from "@orika/bridge"
import { type DesktopRpcClient, P, type PermissionRegistry } from "@orika/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import {
  SessionPermissionEvent,
  SessionPermissionSupportedResult
} from "./contracts/session-permission.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/session-permission.js"

const Surface = "SessionPermission"
const UnsupportedReason = "host-session-permission-unavailable"
const EventMethod = "SessionPermission.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type SessionPermissionError = HostProtocolError

export const SessionPermissionIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: SessionPermissionSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const sessionPermissionCapabilityFact = (method: "request" | "decide" | "listDecisions") =>
  NativeSurface.capabilityFact(Surface, method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: [method] })
    ),
    support: UnsupportedSupport
  })

export const SessionPermissionCapabilityFacts = Object.freeze([
  sessionPermissionCapabilityFact("request"),
  sessionPermissionCapabilityFact("decide"),
  sessionPermissionCapabilityFact("listDecisions")
])

export const SessionPermissionRpcEvents = Object.freeze({
  Event: { payload: SessionPermissionEvent }
})

const SessionPermissionRpcGroup = RpcGroup.make(SessionPermissionIsSupported)

export const SessionPermissionRpcs: RpcGroup.RpcGroup<SessionPermissionRpc> =
  SessionPermissionRpcGroup

export const SessionPermissionMethodNames = Object.freeze(["isSupported"] as const)

export interface SessionPermissionClientApi {
  readonly isSupported: () => Effect.Effect<
    SessionPermissionSupportedResult,
    SessionPermissionError,
    never
  >
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<SessionPermissionEvent, SessionPermissionError, never>
}

export class SessionPermissionClient extends Context.Service<
  SessionPermissionClient,
  SessionPermissionClientApi
>()("@orika/native/SessionPermissionClient") {}

export interface SessionPermissionServiceApi {
  readonly isSupported: () => Effect.Effect<
    SessionPermissionSupportedResult,
    SessionPermissionError,
    never
  >
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<SessionPermissionEvent, SessionPermissionError, never>
}

export class SessionPermission extends Context.Service<
  SessionPermission,
  SessionPermissionServiceApi
>()("@orika/native/SessionPermission") {
  static readonly layer = Layer.effect(SessionPermission)(
    Effect.gen(function* () {
      const client = yield* SessionPermissionClient
      return makeSessionPermissionService(client)
    })
  )
}

export const SessionPermissionLive = SessionPermission.layer

export type SessionPermissionRpc = RpcGroup.Rpcs<typeof SessionPermissionRpcGroup>
export type SessionPermissionRpcHandlers = RpcGroup.HandlersFrom<SessionPermissionRpc>

export const SessionPermissionHandlersLive = SessionPermissionRpcGroup.toLayer({
  "SessionPermission.isSupported": () =>
    Effect.gen(function* () {
      const permissions = yield* SessionPermission
      return yield* permissions.isSupported()
    })
})

export const SessionPermissionSurface = NativeSurface.make(Surface, SessionPermissionRpcGroup, {
  service: SessionPermissionClient,
  handlers: SessionPermissionHandlersLive,
  capabilityFacts: SessionPermissionCapabilityFacts,
  client: (client) => sessionPermissionClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => sessionPermissionClientFromRpcClient(client, exchange)
})

export const makeHostSessionPermissionRpcRuntime = (
  handlers: SessionPermissionRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  SessionPermissionSurface.hostRuntime(handlers, runtimeOptions)

export const makeSessionPermissionMemoryClient = (): Effect.Effect<
  SessionPermissionClientApi,
  never,
  never
> =>
  Effect.succeed(
    Object.freeze({
      isSupported: () => Effect.succeed(new SessionPermissionSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies SessionPermissionClientApi)
  )

export const makeSessionPermissionUnsupportedClient = (): SessionPermissionClientApi =>
  Object.freeze({
    isSupported: () =>
      Effect.succeed(
        new SessionPermissionSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies SessionPermissionClientApi)

const makeSessionPermissionService = (
  client: SessionPermissionClientApi
): SessionPermissionServiceApi =>
  Object.freeze({
    isSupported: () => client.isSupported(),
    events: (profile) => client.events(profile)
  } satisfies SessionPermissionServiceApi)

const sessionPermissionClientFromRpcClient = (
  client: DesktopRpcClient<SessionPermissionRpc>,
  exchange: BridgeClientExchange | undefined
): SessionPermissionClientApi =>
  Object.freeze({
    isSupported: () =>
      runSessionPermissionRpc(
        client["SessionPermission.isSupported"](undefined),
        "SessionPermission.isSupported"
      ),
    events: (profile) =>
      subscribeNativeEvent(exchange, EventMethod, SessionPermissionEvent).pipe(
        Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
      )
  } satisfies SessionPermissionClientApi)

const runSessionPermissionRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, SessionPermissionError, never> => runNativeRpc(effect, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: UnsupportedReason,
    operation,
    recoverable: false
  })
