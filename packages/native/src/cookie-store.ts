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
  CookieStoreEvent,
  CookieStoreGetInput,
  type CookieStoreGetOptions,
  CookieStoreGetResult,
  CookieStoreRemoveInput,
  type CookieStoreRemoveOptions,
  CookieStoreSupportedResult
} from "./contracts/cookie-store.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/cookie-store.js"

const Surface = "CookieStore"
const UnsupportedReason = "host-cookie-store-unavailable"
const LiveWebViewRequiredReason = "host-cookie-store-live-webview-required"
const EventMethod = "CookieStore.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})
const LiveWebViewSupport = NativeSurface.support.partial(LiveWebViewRequiredReason, {
  platforms: [
    { platform: "macos", status: "partial", reason: LiveWebViewRequiredReason },
    { platform: "windows", status: "partial", reason: LiveWebViewRequiredReason },
    { platform: "linux", status: "partial", reason: LiveWebViewRequiredReason }
  ]
})

export type CookieStoreError = HostProtocolError

export const CookieStoreGet = NativeSurface.rpc(Surface, "get", {
  payload: CookieStoreGetInput,
  success: CookieStoreGetResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["get"] })
  ),
  endpoint: "query",
  support: LiveWebViewSupport
})

export const CookieStoreRemove = NativeSurface.rpc(Surface, "remove", {
  payload: CookieStoreRemoveInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["remove"] })
  ),
  endpoint: "mutation",
  support: LiveWebViewSupport
})

export const CookieStoreIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: CookieStoreSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const cookieStoreCapabilityFact = (method: "set") =>
  NativeSurface.capabilityFact(Surface, method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: [method] })
    ),
    support: UnsupportedSupport
  })

export const CookieStoreCapabilityFacts = Object.freeze([cookieStoreCapabilityFact("set")])

export const CookieStoreRpcEvents = Object.freeze({
  Event: { payload: CookieStoreEvent }
})

const CookieStoreRpcGroup = RpcGroup.make(CookieStoreGet, CookieStoreRemove, CookieStoreIsSupported)

export const CookieStoreRpcs: RpcGroup.RpcGroup<CookieStoreRpc> = CookieStoreRpcGroup

export const CookieStoreMethodNames = Object.freeze(["get", "remove"] as const)

export interface CookieStoreClientApi {
  readonly get: (
    input: CookieStoreGetOptions
  ) => Effect.Effect<CookieStoreGetResult, CookieStoreError, never>
  readonly remove: (input: CookieStoreRemoveOptions) => Effect.Effect<void, CookieStoreError, never>
  readonly isSupported: () => Effect.Effect<CookieStoreSupportedResult, CookieStoreError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<CookieStoreEvent, CookieStoreError, never>
}

export class CookieStoreClient extends Context.Service<CookieStoreClient, CookieStoreClientApi>()(
  "@effect-desktop/native/CookieStoreClient"
) {}

export interface CookieStoreServiceApi {
  readonly get: (
    input: CookieStoreGetOptions
  ) => Effect.Effect<CookieStoreGetResult, CookieStoreError, never>
  readonly remove: (input: CookieStoreRemoveOptions) => Effect.Effect<void, CookieStoreError, never>
  readonly isSupported: () => Effect.Effect<CookieStoreSupportedResult, CookieStoreError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<CookieStoreEvent, CookieStoreError, never>
}

export class CookieStore extends Context.Service<CookieStore, CookieStoreServiceApi>()(
  "@effect-desktop/native/CookieStore"
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
  "CookieStore.get": (input) =>
    Effect.gen(function* () {
      const store = yield* CookieStore
      return yield* store.get(input)
    }),
  "CookieStore.remove": (input) =>
    Effect.gen(function* () {
      const store = yield* CookieStore
      yield* store.remove(input)
    }),
  "CookieStore.isSupported": () =>
    Effect.gen(function* () {
      const store = yield* CookieStore
      return yield* store.isSupported()
    })
})

export const CookieStoreSurface = NativeSurface.make(Surface, CookieStoreRpcGroup, {
  service: CookieStoreClient,
  capabilities: CookieStoreMethodNames,
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
      get: (input) =>
        decodeCookieStoreGetInput(input, "CookieStore.get").pipe(
          Effect.map(() => new CookieStoreGetResult({ cookies: [] }))
        ),
      remove: (input) =>
        decodeCookieStoreRemoveInput(input, "CookieStore.remove").pipe(Effect.asVoid),
      isSupported: () => Effect.succeed(new CookieStoreSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies CookieStoreClientApi)
  )

export const makeCookieStoreUnsupportedClient = (): CookieStoreClientApi =>
  Object.freeze({
    get: () => Effect.fail(unsupportedError("CookieStore.get")),
    remove: () => Effect.fail(unsupportedError("CookieStore.remove")),
    isSupported: () =>
      Effect.succeed(
        new CookieStoreSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies CookieStoreClientApi)

const makeCookieStoreService = (client: CookieStoreClientApi): CookieStoreServiceApi =>
  Object.freeze({
    get: (input) => client.get(input),
    remove: (input) => client.remove(input),
    isSupported: () => client.isSupported(),
    events: (profile) => client.events(profile)
  } satisfies CookieStoreServiceApi)

const cookieStoreClientFromRpcClient = (
  client: DesktopRpcClient<CookieStoreRpc>,
  exchange: BridgeClientExchange | undefined
): CookieStoreClientApi =>
  Object.freeze({
    get: (input) =>
      decodeCookieStoreGetInput(input, "CookieStore.get").pipe(
        Effect.flatMap((decoded) =>
          runCookieStoreRpc(client["CookieStore.get"](decoded), "CookieStore.get")
        )
      ),
    remove: (input) =>
      decodeCookieStoreRemoveInput(input, "CookieStore.remove").pipe(
        Effect.flatMap((decoded) =>
          runCookieStoreRpc(client["CookieStore.remove"](decoded), "CookieStore.remove")
        )
      ),
    isSupported: () =>
      runCookieStoreRpc(client["CookieStore.isSupported"](undefined), "CookieStore.isSupported"),
    events: (profile) =>
      subscribeNativeEvent(exchange, EventMethod, CookieStoreEvent).pipe(
        Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
      )
  } satisfies CookieStoreClientApi)

const decodeCookieStoreGetInput = (
  input: unknown,
  operation: string
): Effect.Effect<CookieStoreGetInput, CookieStoreError, never> =>
  decodeNativeInput(CookieStoreGetInput, input, operation)

const decodeCookieStoreRemoveInput = (
  input: unknown,
  operation: string
): Effect.Effect<CookieStoreRemoveInput, CookieStoreError, never> =>
  decodeNativeInput(CookieStoreRemoveInput, input, operation)

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
