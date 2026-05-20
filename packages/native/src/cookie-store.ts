import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  HostProtocolUnsupportedError,
  RpcGroup
} from "@orika/bridge"
import { type DesktopRpcClient, P, type PermissionRegistry } from "@orika/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { CookieStoreEvent, CookieStoreSupportedResult } from "./contracts/cookie-store.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/cookie-store.js"

const Surface = "CookieStore"
const UnsupportedReason = "host-cookie-store-unavailable"
const EventMethod = "CookieStore.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type CookieStoreError = HostProtocolError

export const CookieStoreIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: CookieStoreSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const cookieStoreCapabilityFact = (method: "get" | "set" | "remove") =>
  NativeSurface.capabilityFact(Surface, method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: [method] })
    ),
    support: UnsupportedSupport
  })

export const CookieStoreCapabilityFacts = Object.freeze([
  cookieStoreCapabilityFact("get"),
  cookieStoreCapabilityFact("set"),
  cookieStoreCapabilityFact("remove")
])

export const CookieStoreRpcEvents = Object.freeze({
  Event: { payload: CookieStoreEvent }
})

const CookieStoreRpcGroup = RpcGroup.make(CookieStoreIsSupported)

export const CookieStoreRpcs: RpcGroup.RpcGroup<CookieStoreRpc> = CookieStoreRpcGroup

export const CookieStoreMethodNames = Object.freeze(["isSupported"] as const)

export interface CookieStoreClientApi {
  readonly isSupported: () => Effect.Effect<CookieStoreSupportedResult, CookieStoreError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<CookieStoreEvent, CookieStoreError, never>
}

export class CookieStoreClient extends Context.Service<CookieStoreClient, CookieStoreClientApi>()(
  "@orika/native/CookieStoreClient"
) {}

export interface CookieStoreServiceApi {
  readonly isSupported: () => Effect.Effect<CookieStoreSupportedResult, CookieStoreError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<CookieStoreEvent, CookieStoreError, never>
}

export class CookieStore extends Context.Service<CookieStore, CookieStoreServiceApi>()(
  "@orika/native/CookieStore"
) {
  static readonly layer = Layer.effect(CookieStore)(
    Effect.gen(function* () {
      const client = yield* CookieStoreClient
      return makeCookieStoreService(client)
    })
  )
}

export const CookieStoreLive = CookieStore.layer

export const makeCookieStoreClientLayer = (
  client: CookieStoreClientApi
): Layer.Layer<CookieStoreClient> => Layer.succeed(CookieStoreClient)(client)

export const makeCookieStoreServiceLayer = (
  client: CookieStoreClientApi
): Layer.Layer<CookieStore> => Layer.succeed(CookieStore)(makeCookieStoreService(client))

export const makeCookieStoreBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<CookieStoreClient> => CookieStoreSurface.bridgeClientLayer(exchange, options)

export type CookieStoreRpc = RpcGroup.Rpcs<typeof CookieStoreRpcGroup>
export type CookieStoreRpcHandlers = RpcGroup.HandlersFrom<CookieStoreRpc>

export const CookieStoreHandlersLive = CookieStoreRpcGroup.toLayer({
  "CookieStore.isSupported": () =>
    Effect.gen(function* () {
      const store = yield* CookieStore
      return yield* store.isSupported()
    })
})

export const CookieStoreSurface = NativeSurface.make(Surface, CookieStoreRpcGroup, {
  service: CookieStoreClient,
  handlers: CookieStoreHandlersLive,
  capabilityFacts: CookieStoreCapabilityFacts,
  client: (client) => cookieStoreClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => cookieStoreClientFromRpcClient(client, exchange)
})

export const makeHostCookieStoreRpcRuntime = (
  handlers: CookieStoreRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  CookieStoreSurface.hostRuntime(handlers, runtimeOptions)

export const makeCookieStoreMemoryClient = (): Effect.Effect<CookieStoreClientApi, never, never> =>
  Effect.succeed(
    Object.freeze({
      isSupported: () => Effect.succeed(new CookieStoreSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies CookieStoreClientApi)
  )

export const makeCookieStoreUnsupportedClient = (): CookieStoreClientApi =>
  Object.freeze({
    isSupported: () =>
      Effect.succeed(
        new CookieStoreSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies CookieStoreClientApi)

const makeCookieStoreService = (client: CookieStoreClientApi): CookieStoreServiceApi =>
  Object.freeze({
    isSupported: () => client.isSupported(),
    events: (profile) => client.events(profile)
  } satisfies CookieStoreServiceApi)

const cookieStoreClientFromRpcClient = (
  client: DesktopRpcClient<CookieStoreRpc>,
  exchange: BridgeClientExchange | undefined
): CookieStoreClientApi =>
  Object.freeze({
    isSupported: () =>
      runCookieStoreRpc(client["CookieStore.isSupported"](undefined), "CookieStore.isSupported"),
    events: (profile) =>
      subscribeNativeEvent(exchange, EventMethod, CookieStoreEvent).pipe(
        Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
      )
  } satisfies CookieStoreClientApi)

const runCookieStoreRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, CookieStoreError, never> => runNativeRpc(effect, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: UnsupportedReason,
    operation,
    recoverable: false
  })
