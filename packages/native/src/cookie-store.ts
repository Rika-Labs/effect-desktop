import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  type HostProtocolError,
  RpcGroup
} from "@effect-desktop/bridge"
import {
  type DesktopRpcClient,
  P,
  PermissionActor,
  PermissionContext,
  PermissionDeniedError,
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError
} from "@effect-desktop/core"
import { Clock, Context, Effect, Layer, Option, PubSub, Ref, Schema, Stream } from "effect"

import {
  CookieStoreCookie,
  CookieStoreEvent,
  CookieStoreGetInput,
  CookieStoreGetResult,
  CookieStoreRemoveInput,
  CookieStoreSetInput,
  CookieStoreSupportedResult
} from "./contracts/cookie-store.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
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

export const CookieStoreGet = NativeSurface.rpc(Surface, "get", {
  payload: CookieStoreGetInput,
  success: CookieStoreGetResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["get"] })
  ),
  endpoint: "query",
  support: UnsupportedSupport
})
export const CookieStoreSet = NativeSurface.rpc(Surface, "set", {
  payload: CookieStoreSetInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["set"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const CookieStoreRemove = NativeSurface.rpc(Surface, "remove", {
  payload: CookieStoreRemoveInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["remove"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const CookieStoreIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: CookieStoreSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const CookieStoreRpcEvents = Object.freeze({
  Event: { payload: CookieStoreEvent }
})

const CookieStoreRpcGroup = RpcGroup.make(
  CookieStoreGet,
  CookieStoreSet,
  CookieStoreRemove,
  CookieStoreIsSupported
)

export const CookieStoreRpcs: RpcGroup.RpcGroup<CookieStoreRpc> = CookieStoreRpcGroup

export const CookieStoreMethodNames = Object.freeze([
  "get",
  "set",
  "remove",
  "isSupported"
] as const)

const CookieStoreCapabilityMethods = Object.freeze([
  "get",
  "set",
  "remove"
] as const satisfies readonly (typeof CookieStoreMethodNames)[number][])

export interface CookieStoreClientApi {
  readonly get: (
    input: CookieStoreGetInput
  ) => Effect.Effect<CookieStoreGetResult, CookieStoreError, never>
  readonly set: (input: CookieStoreSetInput) => Effect.Effect<void, CookieStoreError, never>
  readonly remove: (input: CookieStoreRemoveInput) => Effect.Effect<void, CookieStoreError, never>
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
    profile: SessionProfileHandle,
    url: string,
    options?: { readonly name?: string; readonly traceId?: string }
  ) => Effect.Effect<CookieStoreGetResult, CookieStoreError, never>
  readonly set: (
    profile: SessionProfileHandle,
    url: string,
    cookie: CookieStoreCookie,
    options?: { readonly traceId?: string }
  ) => Effect.Effect<void, CookieStoreError, never>
  readonly remove: (
    profile: SessionProfileHandle,
    url: string,
    name: string,
    options?: { readonly traceId?: string }
  ) => Effect.Effect<void, CookieStoreError, never>
  readonly isSupported: () => Effect.Effect<CookieStoreSupportedResult, CookieStoreError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<CookieStoreEvent, CookieStoreError, never>
}

export interface CookieStoreServiceOptions {
  readonly permissions: PermissionRegistryApi
}

export class CookieStore extends Context.Service<CookieStore, CookieStoreServiceApi>()(
  "@effect-desktop/native/CookieStore"
) {
  static readonly layer = Layer.effect(CookieStore)(
    Effect.gen(function* () {
      const client = yield* CookieStoreClient
      const permissions = yield* PermissionRegistry
      return makeCookieStoreService(client, { permissions })
    })
  )
}

export const CookieStoreLive = CookieStore.layer

export const makeCookieStoreClientLayer = (
  client: CookieStoreClientApi
): Layer.Layer<CookieStoreClient> => Layer.succeed(CookieStoreClient)(client)

export const makeCookieStoreServiceLayer = (
  client: CookieStoreClientApi,
  options: CookieStoreServiceOptions
): Layer.Layer<CookieStore> => Layer.succeed(CookieStore)(makeCookieStoreService(client, options))

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
      return yield* store.get(input.profile, input.url, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId })
      })
    }),
  "CookieStore.set": (input) =>
    Effect.gen(function* () {
      const store = yield* CookieStore
      yield* store.set(
        input.profile,
        input.url,
        input.cookie,
        input.traceId === undefined ? {} : { traceId: input.traceId }
      )
    }),
  "CookieStore.remove": (input) =>
    Effect.gen(function* () {
      const store = yield* CookieStore
      yield* store.remove(
        input.profile,
        input.url,
        input.name,
        input.traceId === undefined ? {} : { traceId: input.traceId }
      )
    }),
  "CookieStore.isSupported": () =>
    Effect.gen(function* () {
      const store = yield* CookieStore
      return yield* store.isSupported()
    })
})

export const CookieStoreSurface = NativeSurface.make(Surface, CookieStoreRpcGroup, {
  service: CookieStoreClient,
  capabilities: CookieStoreCapabilityMethods,
  handlers: CookieStoreHandlersLive,
  client: (client) => cookieStoreClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => cookieStoreClientFromRpcClient(client, exchange)
})

export const makeHostCookieStoreRpcRuntime = (
  handlers: CookieStoreRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  CookieStoreSurface.hostRuntime(handlers, runtimeOptions)

export interface CookieStoreMemoryClientOptions {
  readonly failure?: Partial<Record<"get" | "set" | "remove", CookieStoreError>>
}

export const makeCookieStoreMemoryClient = (
  options: CookieStoreMemoryClientOptions = {}
): Effect.Effect<CookieStoreClientApi, never, never> =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock
    const pubsub = yield* PubSub.bounded<CookieStoreEvent>({ capacity: 256, replay: 64 })
    const cookies = yield* Ref.make<ReadonlyMap<string, ReadonlyMap<string, CookieStoreCookie>>>(
      new Map<string, ReadonlyMap<string, CookieStoreCookie>>()
    )

    return Object.freeze({
      get: (input) =>
        validateGetInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.get,
              Ref.get(cookies).pipe(
                Effect.map((current) => {
                  const scoped =
                    current.get(valid.profile.id) ?? new Map<string, CookieStoreCookie>()
                  const values = Array.from(scoped.values()).filter(
                    (cookie) =>
                      cookieApplies(cookie, valid.url) && cookieNameMatches(cookie, valid.name)
                  )
                  return new CookieStoreGetResult({ cookies: values })
                })
              )
            )
          )
        ),
      set: (input) =>
        validateSetInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.set,
              Effect.gen(function* () {
                yield* Ref.update(cookies, (current) => {
                  const scoped = new Map<string, CookieStoreCookie>(
                    current.get(valid.profile.id) ?? new Map<string, CookieStoreCookie>()
                  )
                  scoped.set(cookieKey(valid.cookie), valid.cookie)
                  return new Map(current).set(valid.profile.id, scoped)
                })
                yield* publishEvent(pubsub, clock, "set", valid.profile, valid.url, {
                  cookie: valid.cookie
                })
              })
            )
          )
        ),
      remove: (input) =>
        validateRemoveInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.remove,
              Effect.gen(function* () {
                yield* Ref.update(cookies, (current) => {
                  const scoped = new Map<string, CookieStoreCookie>(
                    current.get(valid.profile.id) ?? new Map<string, CookieStoreCookie>()
                  )
                  for (const [key, cookie] of scoped) {
                    if (cookie.name === valid.name && cookieApplies(cookie, valid.url)) {
                      scoped.delete(key)
                    }
                  }
                  return new Map(current).set(valid.profile.id, scoped)
                })
                yield* publishEvent(pubsub, clock, "removed", valid.profile, valid.url, {
                  name: valid.name
                })
              })
            )
          )
        ),
      isSupported: () => Effect.succeed(new CookieStoreSupportedResult({ supported: true })),
      events: (profile) =>
        Stream.fromPubSub(pubsub).pipe(
          Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
        )
    } satisfies CookieStoreClientApi)
  })

export const makeCookieStoreUnsupportedClient = (): CookieStoreClientApi =>
  Object.freeze({
    get: (input) =>
      validateGetInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("CookieStore.get")))
      ),
    set: (input) =>
      validateSetInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("CookieStore.set")))
      ),
    remove: (input) =>
      validateRemoveInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("CookieStore.remove")))
      ),
    isSupported: () =>
      Effect.succeed(
        new CookieStoreSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies CookieStoreClientApi)

const makeCookieStoreService = (
  client: CookieStoreClientApi,
  options: CookieStoreServiceOptions
): CookieStoreServiceApi => {
  const service: CookieStoreServiceApi = {
    get: (profile, url, requestOptions) =>
      validateGetInput({
        profile,
        url,
        ...(requestOptions?.name === undefined ? {} : { name: requestOptions.name }),
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(options.permissions, "get", valid.profile.id, valid.traceId).pipe(
            Effect.andThen(client.get(valid))
          )
        )
      ),
    set: (profile, url, cookie, requestOptions) =>
      validateSetInput({
        profile,
        url,
        cookie,
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(options.permissions, "set", valid.profile.id, valid.traceId).pipe(
            Effect.andThen(client.set(valid))
          )
        )
      ),
    remove: (profile, url, name, requestOptions) =>
      validateRemoveInput({
        profile,
        url,
        name,
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(options.permissions, "remove", valid.profile.id, valid.traceId).pipe(
            Effect.andThen(client.remove(valid))
          )
        )
      ),
    isSupported: () => client.isSupported(),
    events: (profile) => client.events(profile)
  }

  return Object.freeze(service)
}

const cookieStoreClientFromRpcClient = (
  client: DesktopRpcClient<CookieStoreRpc>,
  exchange: BridgeClientExchange | undefined
): CookieStoreClientApi =>
  Object.freeze({
    get: (input) =>
      validateGetInput(input).pipe(
        Effect.flatMap((valid) =>
          runCookieStoreRpc(client["CookieStore.get"](valid), "CookieStore.get")
        )
      ),
    set: (input) =>
      validateSetInput(input).pipe(
        Effect.flatMap((valid) =>
          runCookieStoreRpc(client["CookieStore.set"](valid), "CookieStore.set")
        )
      ),
    remove: (input) =>
      validateRemoveInput(input).pipe(
        Effect.flatMap((valid) =>
          runCookieStoreRpc(client["CookieStore.remove"](valid), "CookieStore.remove")
        )
      ),
    isSupported: () =>
      runCookieStoreRpc(client["CookieStore.isSupported"](undefined), "CookieStore.isSupported"),
    events: (profile) =>
      subscribeNativeEvent(exchange, EventMethod, CookieStoreEvent).pipe(
        Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
      )
  } satisfies CookieStoreClientApi)

const validateGetInput = (input: unknown) =>
  decodeNativeInput(CookieStoreGetInput, input, "CookieStore.get")
const validateSetInput = (input: unknown) =>
  decodeNativeInput(CookieStoreSetInput, input, "CookieStore.set")
const validateRemoveInput = (input: unknown) =>
  decodeNativeInput(CookieStoreRemoveInput, input, "CookieStore.remove")

const runCookieStoreRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, CookieStoreError, never> => runNativeRpc(effect, operation, Surface)

const authorize = (
  permissions: PermissionRegistryApi,
  method: "get" | "set" | "remove",
  resource: string,
  traceId: string | undefined
): Effect.Effect<void, CookieStoreError, never> =>
  permissions
    .check(
      capability(method),
      new PermissionContext({
        actor: new PermissionActor({ kind: "app", id: "app" }),
        resource,
        traceId: traceId ?? `CookieStore.${method}`
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: PermissionRegistryError) =>
        error instanceof PermissionDeniedError
          ? Effect.fail(permissionDeniedError(capability(method), error, `CookieStore.${method}`))
          : Effect.fail(
              makeHostProtocolInternalError(
                `cookie store permission registry failure: ${error._tag}`,
                `CookieStore.${method}`
              )
            )
      )
    )

const cookieApplies = (cookie: CookieStoreCookie, url: string): boolean => {
  const parsed = new URL(url)
  return parsed.hostname === cookie.domain && parsed.pathname.startsWith(cookie.path)
}

const cookieNameMatches = (cookie: CookieStoreCookie, name: string | undefined): boolean =>
  name === undefined || cookie.name === name

const cookieKey = (cookie: CookieStoreCookie): string =>
  `${cookie.domain}\u{1f}${cookie.path}\u{1f}${cookie.name}`

const publishEvent = (
  pubsub: PubSub.PubSub<CookieStoreEvent>,
  clock: Clock.Clock,
  phase: "set" | "removed",
  profile: SessionProfileHandle,
  url: string,
  detail: { readonly cookie?: CookieStoreCookie; readonly name?: string }
): Effect.Effect<void, never, never> =>
  PubSub.publish(
    pubsub,
    new CookieStoreEvent({
      type: "cookie-store-event",
      timestamp: clock.currentTimeMillisUnsafe(),
      phase,
      profile,
      url,
      ...(detail.cookie === undefined ? {} : { cookie: detail.cookie }),
      ...(detail.name === undefined ? {} : { name: detail.name })
    })
  ).pipe(Effect.asVoid)

const capability = (method: "get" | "set" | "remove") =>
  P.nativeInvoke({ primitive: Surface, methods: [method] })

const permissionDeniedError = (
  cap: ReturnType<typeof capability>,
  error: PermissionDeniedError,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability: JSON.stringify(cap),
    ...(Option.isNone(error.resource) ? {} : { resource: error.resource.value }),
    message: error.message,
    operation,
    recoverable: false
  })

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: UnsupportedReason,
    operation,
    recoverable: false
  })

const failOr = <A>(
  failure: CookieStoreError | undefined,
  effect: Effect.Effect<A, CookieStoreError, never>
): Effect.Effect<A, CookieStoreError, never> =>
  failure === undefined ? effect : Effect.fail(failure)
