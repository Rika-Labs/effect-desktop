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

import {
  NetworkAuthEvent,
  NetworkAuthProxyResult,
  NetworkAuthSetProxyInput,
  NetworkAuthSupportedResult
} from "./contracts/network-auth.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/network-auth.js"

const Surface = "NetworkAuth"
const UnsupportedReason = "host-network-auth-unavailable"
const SetProxySupportReason = "host-network-auth-proxy-future-webviews-only"
const EventMethod = "NetworkAuth.Event"
const SetProxySupport = NativeSurface.support.partial(SetProxySupportReason, {
  platforms: [
    {
      platform: "macos",
      status: "unsupported",
      reason: "host-network-auth-proxy-platform-unavailable"
    },
    { platform: "windows", status: "partial", reason: SetProxySupportReason },
    { platform: "linux", status: "partial", reason: SetProxySupportReason }
  ]
})
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type NetworkAuthError = HostProtocolError

export const NetworkAuthIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: NetworkAuthSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const NetworkAuthSetProxy = NativeSurface.rpc(Surface, "setProxy", {
  payload: NetworkAuthSetProxyInput,
  success: NetworkAuthProxyResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["setProxy"] })
  ),
  endpoint: "mutation",
  support: SetProxySupport
})

const networkAuthCapabilityFact = (method: "handleAuth" | "handleCertificate") =>
  NativeSurface.capabilityFact(Surface, method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: [method] })
    ),
    support: UnsupportedSupport
  })

export const NetworkAuthCapabilityFacts = Object.freeze([
  networkAuthCapabilityFact("handleAuth"),
  networkAuthCapabilityFact("handleCertificate")
])

export const NetworkAuthRpcEvents = Object.freeze({
  Event: { payload: NetworkAuthEvent }
})

const NetworkAuthRpcGroup = RpcGroup.make(NetworkAuthIsSupported, NetworkAuthSetProxy)

export const NetworkAuthRpcs: RpcGroup.RpcGroup<NetworkAuthRpc> = NetworkAuthRpcGroup

export const NetworkAuthMethodNames = Object.freeze(["setProxy"] as const)

export interface NetworkAuthClientApi {
  readonly isSupported: () => Effect.Effect<NetworkAuthSupportedResult, NetworkAuthError, never>
  readonly setProxy: (
    input: NetworkAuthSetProxyInput
  ) => Effect.Effect<NetworkAuthProxyResult, NetworkAuthError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<NetworkAuthEvent, NetworkAuthError, never>
}

export class NetworkAuthClient extends Context.Service<NetworkAuthClient, NetworkAuthClientApi>()(
  "@effect-desktop/native/NetworkAuthClient"
) {}

export interface NetworkAuthServiceApi {
  readonly isSupported: () => Effect.Effect<NetworkAuthSupportedResult, NetworkAuthError, never>
  readonly setProxy: (
    input: NetworkAuthSetProxyInput
  ) => Effect.Effect<NetworkAuthProxyResult, NetworkAuthError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<NetworkAuthEvent, NetworkAuthError, never>
}

export class NetworkAuth extends Context.Service<NetworkAuth, NetworkAuthServiceApi>()(
  "@effect-desktop/native/NetworkAuth"
) {
  static readonly layer = Layer.effect(NetworkAuth)(
    Effect.gen(function* () {
      const client = yield* NetworkAuthClient
      return makeNetworkAuthService(client)
    })
  )
}

export const NetworkAuthLive = NetworkAuth.layer

export const makeNetworkAuthClientLayer = (
  client: NetworkAuthClientApi
): Layer.Layer<NetworkAuthClient> => Layer.succeed(NetworkAuthClient)(client)

export const makeNetworkAuthServiceLayer = (
  client: NetworkAuthClientApi
): Layer.Layer<NetworkAuth> => Layer.succeed(NetworkAuth)(makeNetworkAuthService(client))

export const makeNetworkAuthBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<NetworkAuthClient> => NetworkAuthSurface.bridgeClientLayer(exchange, options)

export type NetworkAuthRpc = RpcGroup.Rpcs<typeof NetworkAuthRpcGroup>
export type NetworkAuthRpcHandlers = RpcGroup.HandlersFrom<NetworkAuthRpc>

export const NetworkAuthHandlersLive = NetworkAuthRpcGroup.toLayer({
  "NetworkAuth.isSupported": () =>
    Effect.gen(function* () {
      const networkAuth = yield* NetworkAuth
      return yield* networkAuth.isSupported()
    }),
  "NetworkAuth.setProxy": (input) =>
    Effect.gen(function* () {
      const networkAuth = yield* NetworkAuth
      return yield* networkAuth.setProxy(input)
    })
})

export const NetworkAuthSurface = NativeSurface.make(Surface, NetworkAuthRpcGroup, {
  service: NetworkAuthClient,
  capabilities: NetworkAuthMethodNames,
  handlers: NetworkAuthHandlersLive,
  capabilityFacts: NetworkAuthCapabilityFacts,
  client: (client) => networkAuthClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => networkAuthClientFromRpcClient(client, exchange)
})

export const makeHostNetworkAuthRpcRuntime = (
  handlers: NetworkAuthRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  NetworkAuthSurface.hostRuntime(handlers, runtimeOptions)

export const makeNetworkAuthMemoryClient = (): Effect.Effect<NetworkAuthClientApi, never, never> =>
  Effect.succeed(
    Object.freeze({
      isSupported: () => Effect.succeed(new NetworkAuthSupportedResult({ supported: true })),
      setProxy: (input) =>
        Effect.succeed(
          new NetworkAuthProxyResult(
            input.server === undefined
              ? {
                  profile: input.profile,
                  mode: input.mode,
                  bypass: input.bypass ?? []
                }
              : {
                  profile: input.profile,
                  mode: input.mode,
                  server: input.server,
                  bypass: input.bypass ?? []
                }
          )
        ),
      events: () => Stream.empty
    } satisfies NetworkAuthClientApi)
  )

export const makeNetworkAuthUnsupportedClient = (): NetworkAuthClientApi =>
  Object.freeze({
    isSupported: () =>
      Effect.succeed(
        new NetworkAuthSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    setProxy: () => Effect.fail(unsupportedError("NetworkAuth.setProxy")),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies NetworkAuthClientApi)

const makeNetworkAuthService = (client: NetworkAuthClientApi): NetworkAuthServiceApi =>
  Object.freeze({
    isSupported: () => client.isSupported(),
    setProxy: (input) => client.setProxy(input),
    events: (profile) => client.events(profile)
  } satisfies NetworkAuthServiceApi)

const networkAuthClientFromRpcClient = (
  client: DesktopRpcClient<NetworkAuthRpc>,
  exchange: BridgeClientExchange | undefined
): NetworkAuthClientApi =>
  Object.freeze({
    isSupported: () =>
      runNetworkAuthRpc(client["NetworkAuth.isSupported"](undefined), "NetworkAuth.isSupported"),
    setProxy: (input) =>
      runNetworkAuthRpc(client["NetworkAuth.setProxy"](input), "NetworkAuth.setProxy"),
    events: (profile) =>
      subscribeNativeEvent(exchange, EventMethod, NetworkAuthEvent).pipe(
        Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
      )
  } satisfies NetworkAuthClientApi)

const runNetworkAuthRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, NetworkAuthError, never> => runNativeRpc(effect, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: UnsupportedReason,
    operation,
    recoverable: false
  })
