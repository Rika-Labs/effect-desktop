import {
  type BridgeClientExchange,
  type HostProtocolError,
  HostProtocolUnsupportedError,
  RpcGroup
} from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Context, Effect, Schema, Stream } from "effect"

import {
  NetworkAuthEvent,
  NetworkAuthProxyResult,
  NetworkAuthSetProxyInput,
  NetworkAuthSupportedResult
} from "./contracts/network-auth.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import { decodeNativeInput, runNativeRpc, runNativeRpcStream } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

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

const UnsupportedCapabilityFacts = Object.freeze([
  networkAuthCapabilityFact("handleAuth"),
  networkAuthCapabilityFact("handleCertificate")
])

const NetworkAuthEventStream = NativeSurface.event(Surface, "Event", {
  payload: NetworkAuthEvent,
  support: NativeSurface.support.supported
})

const NetworkAuthRpcGroup = RpcGroup.make(
  NetworkAuthIsSupported,
  NetworkAuthSetProxy,
  NetworkAuthEventStream
)

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

export class NetworkAuth extends Context.Service<NetworkAuth, NetworkAuthClientApi>()(
  "@orika/native/NetworkAuth"
) {}

export type NetworkAuthRpc = RpcGroup.Rpcs<typeof NetworkAuthRpcGroup>
export type NetworkAuthRpcHandlers<R = never> = NativeRpcHandlers<typeof NetworkAuthRpcGroup, R>

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
    }),
  "NetworkAuth.events.Event": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const networkAuth = yield* NetworkAuth
        return networkAuth.events()
      })
    )
})

export const NetworkAuthSurface = NativeSurface.make(Surface, NetworkAuthRpcGroup, {
  service: NetworkAuth,
  capabilities: NetworkAuthMethodNames,
  handlers: NetworkAuthHandlersLive,
  capabilityFacts: UnsupportedCapabilityFacts,
  client: (client) => networkAuthClientFromRpcClient(client),
  bridgeClient: (client, exchange) => networkAuthBridgeClientFromRpcClient(client, exchange)
})

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

const networkAuthClientFromRpcClient = (
  client: DesktopRpcClient<NetworkAuthRpc>
): NetworkAuthClientApi =>
  Object.freeze({
    isSupported: () =>
      runNetworkAuthRpc(client["NetworkAuth.isSupported"](undefined), "NetworkAuth.isSupported"),
    setProxy: (input) =>
      decodeNativeInput(NetworkAuthSetProxyInput, input, "NetworkAuth.setProxy").pipe(
        Effect.flatMap((decoded) =>
          runNetworkAuthRpc(client["NetworkAuth.setProxy"](decoded), "NetworkAuth.setProxy")
        )
      ),
    events: (profile) =>
      runNetworkAuthRpcStream(
        client["NetworkAuth.events.Event"](undefined),
        "NetworkAuth.events.Event"
      ).pipe(Stream.filter((event) => profile === undefined || event.profile.id === profile.id))
  } satisfies NetworkAuthClientApi)

const networkAuthBridgeClientFromRpcClient = (
  client: DesktopRpcClient<NetworkAuthRpc>,
  exchange: BridgeClientExchange
): NetworkAuthClientApi =>
  Object.freeze({
    isSupported: () =>
      runNetworkAuthRpc(client["NetworkAuth.isSupported"](undefined), "NetworkAuth.isSupported"),
    setProxy: (input) =>
      decodeNativeInput(NetworkAuthSetProxyInput, input, "NetworkAuth.setProxy").pipe(
        Effect.flatMap((decoded) =>
          runNetworkAuthRpc(client["NetworkAuth.setProxy"](decoded), "NetworkAuth.setProxy")
        )
      ),
    events: (profile) =>
      NativeSurface.subscribeEvent(exchange, NetworkAuthEventStream).pipe(
        Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
      )
  } satisfies NetworkAuthClientApi)

const runNetworkAuthRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, NetworkAuthError, never> => runNativeRpc(effect, operation, Surface)

const runNetworkAuthRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  operation: string
): Stream.Stream<A, NetworkAuthError, never> => runNativeRpcStream(stream, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: UnsupportedReason,
    operation,
    recoverable: false
  })
