import {
  type BridgeClientExchange,
  type HostProtocolError,
  HostProtocolUnsupportedError,
  RpcGroup
} from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Context, Effect, Schema, Stream } from "effect"

import {
  SessionPermissionEvent,
  SessionPermissionSupportedResult
} from "./contracts/session-permission.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import { runNativeRpc, runNativeRpcStream } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

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

const UnsupportedCapabilityFacts = Object.freeze([
  sessionPermissionCapabilityFact("request"),
  sessionPermissionCapabilityFact("decide"),
  sessionPermissionCapabilityFact("listDecisions")
])

const SessionPermissionEventStream = NativeSurface.event(Surface, "Event", {
  payload: SessionPermissionEvent,
  support: UnsupportedSupport
})

const SessionPermissionRpcGroup = RpcGroup.make(
  SessionPermissionIsSupported,
  SessionPermissionEventStream
)

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

export class SessionPermission extends Context.Service<
  SessionPermission,
  SessionPermissionClientApi
>()("@orika/native/SessionPermission") {}

export type SessionPermissionRpc = RpcGroup.Rpcs<typeof SessionPermissionRpcGroup>
export type SessionPermissionRpcHandlers<R = never> = NativeRpcHandlers<
  typeof SessionPermissionRpcGroup,
  R
>

export const SessionPermissionHandlersLive = SessionPermissionRpcGroup.toLayer({
  "SessionPermission.isSupported": () =>
    Effect.gen(function* () {
      const permissions = yield* SessionPermission
      return yield* permissions.isSupported()
    }),
  "SessionPermission.events.Event": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const permissions = yield* SessionPermission
        return permissions.events()
      })
    )
})

export const SessionPermissionSurface = NativeSurface.make(Surface, SessionPermissionRpcGroup, {
  service: SessionPermission,
  handlers: SessionPermissionHandlersLive,
  capabilityFacts: UnsupportedCapabilityFacts,
  client: (client) => sessionPermissionClientFromRpcClient(client),
  bridgeClient: (client, exchange) => sessionPermissionBridgeClientFromRpcClient(client, exchange)
})

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

const sessionPermissionClientFromRpcClient = (
  client: DesktopRpcClient<SessionPermissionRpc>
): SessionPermissionClientApi =>
  Object.freeze({
    isSupported: () =>
      runSessionPermissionRpc(
        client["SessionPermission.isSupported"](undefined),
        "SessionPermission.isSupported"
      ),
    events: (profile) =>
      runSessionPermissionRpcStream(
        client["SessionPermission.events.Event"](undefined),
        "SessionPermission.events.Event"
      ).pipe(Stream.filter((event) => profile === undefined || event.profile.id === profile.id))
  } satisfies SessionPermissionClientApi)

const sessionPermissionBridgeClientFromRpcClient = (
  client: DesktopRpcClient<SessionPermissionRpc>,
  exchange: BridgeClientExchange
): SessionPermissionClientApi =>
  Object.freeze({
    isSupported: () =>
      runSessionPermissionRpc(
        client["SessionPermission.isSupported"](undefined),
        "SessionPermission.isSupported"
      ),
    events: (profile) =>
      NativeSurface.subscribeEvent(exchange, SessionPermissionEventStream).pipe(
        Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
      )
  } satisfies SessionPermissionClientApi)

const runSessionPermissionRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, SessionPermissionError, never> => runNativeRpc(effect, operation, Surface)

const runSessionPermissionRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  operation: string
): Stream.Stream<A, SessionPermissionError, never> => runNativeRpcStream(stream, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: UnsupportedReason,
    operation,
    recoverable: false
  })
