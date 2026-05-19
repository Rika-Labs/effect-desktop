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
  BrowsingDataClearInput,
  BrowsingDataClearResult,
  BrowsingDataEstimateInput,
  BrowsingDataEstimateResult,
  BrowsingDataEvent,
  BrowsingDataListTypesResult,
  BrowsingDataSupportedResult,
  BrowsingDataType,
  BrowsingDataTypeEstimate
} from "./contracts/browsing-data.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/browsing-data.js"

const Surface = "BrowsingData"
const UnsupportedReason = "host-browsing-data-unavailable"
const EventMethod = "BrowsingData.Event"
const SupportedTypes = Object.freeze([
  "cache",
  "cookies",
  "localStorage",
  "indexedDb",
  "history",
  "serviceWorkers"
] as const satisfies readonly BrowsingDataType[])
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type BrowsingDataError = HostProtocolError

export const BrowsingDataClear = NativeSurface.rpc(Surface, "clear", {
  payload: BrowsingDataClearInput,
  success: BrowsingDataClearResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["clear"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const BrowsingDataEstimate = NativeSurface.rpc(Surface, "estimate", {
  payload: BrowsingDataEstimateInput,
  success: BrowsingDataEstimateResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["estimate"] })
  ),
  endpoint: "query",
  support: UnsupportedSupport
})
export const BrowsingDataListTypes = NativeSurface.rpc(Surface, "listTypes", {
  payload: Schema.Void,
  success: BrowsingDataListTypesResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["listTypes"] })
  ),
  endpoint: "query",
  support: UnsupportedSupport
})
export const BrowsingDataIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: BrowsingDataSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const BrowsingDataRpcEvents = Object.freeze({
  Event: { payload: BrowsingDataEvent }
})

const BrowsingDataRpcGroup = RpcGroup.make(
  BrowsingDataClear,
  BrowsingDataEstimate,
  BrowsingDataListTypes,
  BrowsingDataIsSupported
)

export const BrowsingDataRpcs: RpcGroup.RpcGroup<BrowsingDataRpc> = BrowsingDataRpcGroup

export const BrowsingDataMethodNames = Object.freeze([
  "clear",
  "estimate",
  "listTypes",
  "isSupported"
] as const)

const BrowsingDataCapabilityMethods = Object.freeze([
  "clear",
  "estimate",
  "listTypes"
] as const satisfies readonly (typeof BrowsingDataMethodNames)[number][])

export interface BrowsingDataClientApi {
  readonly clear: (
    input: BrowsingDataClearInput
  ) => Effect.Effect<BrowsingDataClearResult, BrowsingDataError, never>
  readonly estimate: (
    input: BrowsingDataEstimateInput
  ) => Effect.Effect<BrowsingDataEstimateResult, BrowsingDataError, never>
  readonly listTypes: () => Effect.Effect<BrowsingDataListTypesResult, BrowsingDataError, never>
  readonly isSupported: () => Effect.Effect<BrowsingDataSupportedResult, BrowsingDataError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<BrowsingDataEvent, BrowsingDataError, never>
}

export class BrowsingDataClient extends Context.Service<
  BrowsingDataClient,
  BrowsingDataClientApi
>()("@effect-desktop/native/BrowsingDataClient") {}

export interface BrowsingDataServiceApi {
  readonly clear: (
    profile: SessionProfileHandle,
    types: readonly BrowsingDataType[],
    options?: { readonly traceId?: string }
  ) => Effect.Effect<BrowsingDataClearResult, BrowsingDataError, never>
  readonly estimate: (
    profile: SessionProfileHandle,
    options?: { readonly types?: readonly BrowsingDataType[]; readonly traceId?: string }
  ) => Effect.Effect<BrowsingDataEstimateResult, BrowsingDataError, never>
  readonly listTypes: () => Effect.Effect<BrowsingDataListTypesResult, BrowsingDataError, never>
  readonly isSupported: () => Effect.Effect<BrowsingDataSupportedResult, BrowsingDataError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<BrowsingDataEvent, BrowsingDataError, never>
}

export interface BrowsingDataServiceOptions {
  readonly permissions: PermissionRegistryApi
}

export class BrowsingData extends Context.Service<BrowsingData, BrowsingDataServiceApi>()(
  "@effect-desktop/native/BrowsingData"
) {
  static readonly layer = Layer.effect(BrowsingData)(
    Effect.gen(function* () {
      const client = yield* BrowsingDataClient
      const permissions = yield* PermissionRegistry
      return makeBrowsingDataService(client, { permissions })
    })
  )
}

export const BrowsingDataLive = BrowsingData.layer

export const makeBrowsingDataClientLayer = (
  client: BrowsingDataClientApi
): Layer.Layer<BrowsingDataClient> => Layer.succeed(BrowsingDataClient)(client)

export const makeBrowsingDataServiceLayer = (
  client: BrowsingDataClientApi,
  options: BrowsingDataServiceOptions
): Layer.Layer<BrowsingData> =>
  Layer.succeed(BrowsingData)(makeBrowsingDataService(client, options))

export const makeBrowsingDataBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<BrowsingDataClient> => BrowsingDataSurface.bridgeClientLayer(exchange, options)

export type BrowsingDataRpc = RpcGroup.Rpcs<typeof BrowsingDataRpcGroup>
export type BrowsingDataRpcHandlers = RpcGroup.HandlersFrom<BrowsingDataRpc>

export const BrowsingDataHandlersLive = BrowsingDataRpcGroup.toLayer({
  "BrowsingData.clear": (input) =>
    Effect.gen(function* () {
      const browsingData = yield* BrowsingData
      return yield* browsingData.clear(
        input.profile,
        input.types,
        input.traceId === undefined ? {} : { traceId: input.traceId }
      )
    }),
  "BrowsingData.estimate": (input) =>
    Effect.gen(function* () {
      const browsingData = yield* BrowsingData
      return yield* browsingData.estimate(input.profile, {
        ...(input.types === undefined ? {} : { types: input.types }),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId })
      })
    }),
  "BrowsingData.listTypes": () =>
    Effect.gen(function* () {
      const browsingData = yield* BrowsingData
      return yield* browsingData.listTypes()
    }),
  "BrowsingData.isSupported": () =>
    Effect.gen(function* () {
      const browsingData = yield* BrowsingData
      return yield* browsingData.isSupported()
    })
})

export const BrowsingDataSurface = NativeSurface.make(Surface, BrowsingDataRpcGroup, {
  service: BrowsingDataClient,
  capabilities: BrowsingDataCapabilityMethods,
  handlers: BrowsingDataHandlersLive,
  client: (client) => browsingDataClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => browsingDataClientFromRpcClient(client, exchange)
})

export const makeHostBrowsingDataRpcRuntime = (
  handlers: BrowsingDataRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  BrowsingDataSurface.hostRuntime(handlers, runtimeOptions)

export interface BrowsingDataMemoryClientOptions {
  readonly failure?: Partial<Record<"clear" | "estimate" | "listTypes", BrowsingDataError>>
  readonly unsupportedTypes?: readonly BrowsingDataType[]
}

export const makeBrowsingDataMemoryClient = (
  options: BrowsingDataMemoryClientOptions = {}
): Effect.Effect<BrowsingDataClientApi, never, never> =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock
    const pubsub = yield* PubSub.bounded<BrowsingDataEvent>({ capacity: 256, replay: 64 })
    const activeData = yield* Ref.make<ReadonlyMap<string, ReadonlySet<BrowsingDataType>>>(
      new Map()
    )
    const unsupported = new Set(options.unsupportedTypes ?? [])

    return Object.freeze({
      clear: (input) =>
        validateClearInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.clear,
              Effect.gen(function* () {
                const cleared = valid.types.filter((type) => !unsupported.has(type))
                const unsupportedTypes = valid.types.filter((type) => unsupported.has(type))
                yield* Ref.update(activeData, (current) => {
                  const currentTypes = new Set(current.get(valid.profile.id) ?? SupportedTypes)
                  for (const type of cleared) {
                    currentTypes.delete(type)
                  }
                  return new Map(current).set(valid.profile.id, currentTypes)
                })
                const result = new BrowsingDataClearResult({
                  cleared,
                  unsupported: unsupportedTypes
                })
                yield* publishEvent(pubsub, clock, valid.profile, result)
                return result
              })
            )
          )
        ),
      estimate: (input) =>
        validateEstimateInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.estimate,
              Ref.get(activeData).pipe(
                Effect.map((current) => {
                  const remaining = current.get(valid.profile.id) ?? new Set(SupportedTypes)
                  const selected = valid.types ?? SupportedTypes
                  return new BrowsingDataEstimateResult({
                    estimates: selected.map((type) => {
                      const isSupported = !unsupported.has(type)
                      return new BrowsingDataTypeEstimate({
                        type,
                        supported: isSupported,
                        ...(isSupported ? { bytes: remaining.has(type) ? 1024 : 0 } : {})
                      })
                    })
                  })
                })
              )
            )
          )
        ),
      listTypes: () =>
        failOr(
          options.failure?.listTypes,
          Effect.succeed(new BrowsingDataListTypesResult({ types: [...SupportedTypes] }))
        ),
      isSupported: () => Effect.succeed(new BrowsingDataSupportedResult({ supported: true })),
      events: (profile) =>
        Stream.fromPubSub(pubsub).pipe(
          Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
        )
    } satisfies BrowsingDataClientApi)
  })

export const makeBrowsingDataUnsupportedClient = (): BrowsingDataClientApi =>
  Object.freeze({
    clear: (input) =>
      validateClearInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("BrowsingData.clear")))
      ),
    estimate: (input) =>
      validateEstimateInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("BrowsingData.estimate")))
      ),
    listTypes: () => Effect.fail(unsupportedError("BrowsingData.listTypes")),
    isSupported: () =>
      Effect.succeed(
        new BrowsingDataSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies BrowsingDataClientApi)

const makeBrowsingDataService = (
  client: BrowsingDataClientApi,
  options: BrowsingDataServiceOptions
): BrowsingDataServiceApi => {
  const service: BrowsingDataServiceApi = {
    clear: (profile, types, requestOptions) =>
      validateClearInput({
        profile,
        types,
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(options.permissions, "clear", valid.profile.id, valid.traceId).pipe(
            Effect.andThen(client.clear(valid))
          )
        )
      ),
    estimate: (profile, requestOptions) =>
      validateEstimateInput({
        profile,
        ...(requestOptions?.types === undefined ? {} : { types: requestOptions.types }),
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(options.permissions, "estimate", valid.profile.id, valid.traceId).pipe(
            Effect.andThen(client.estimate(valid))
          )
        )
      ),
    listTypes: () =>
      authorize(options.permissions, "listTypes", "browsing-data", undefined).pipe(
        Effect.andThen(client.listTypes())
      ),
    isSupported: () => client.isSupported(),
    events: (profile) => client.events(profile)
  }

  return Object.freeze(service)
}

const browsingDataClientFromRpcClient = (
  client: DesktopRpcClient<BrowsingDataRpc>,
  exchange: BridgeClientExchange | undefined
): BrowsingDataClientApi =>
  Object.freeze({
    clear: (input) =>
      validateClearInput(input).pipe(
        Effect.flatMap((valid) =>
          runBrowsingDataRpc(client["BrowsingData.clear"](valid), "BrowsingData.clear")
        )
      ),
    estimate: (input) =>
      validateEstimateInput(input).pipe(
        Effect.flatMap((valid) =>
          runBrowsingDataRpc(client["BrowsingData.estimate"](valid), "BrowsingData.estimate")
        )
      ),
    listTypes: () =>
      runBrowsingDataRpc(client["BrowsingData.listTypes"](undefined), "BrowsingData.listTypes"),
    isSupported: () =>
      runBrowsingDataRpc(client["BrowsingData.isSupported"](undefined), "BrowsingData.isSupported"),
    events: (profile) =>
      subscribeNativeEvent(exchange, EventMethod, BrowsingDataEvent).pipe(
        Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
      )
  } satisfies BrowsingDataClientApi)

const validateClearInput = (input: unknown) =>
  decodeNativeInput(BrowsingDataClearInput, input, "BrowsingData.clear")
const validateEstimateInput = (input: unknown) =>
  decodeNativeInput(BrowsingDataEstimateInput, input, "BrowsingData.estimate")

const runBrowsingDataRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, BrowsingDataError, never> => runNativeRpc(effect, operation, Surface)

const authorize = (
  permissions: PermissionRegistryApi,
  method: "clear" | "estimate" | "listTypes",
  resource: string,
  traceId: string | undefined
): Effect.Effect<void, BrowsingDataError, never> =>
  permissions
    .check(
      capability(method),
      new PermissionContext({
        actor: new PermissionActor({ kind: "app", id: "app" }),
        resource,
        traceId: traceId ?? `BrowsingData.${method}`
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: PermissionRegistryError) =>
        error instanceof PermissionDeniedError
          ? Effect.fail(permissionDeniedError(capability(method), error, `BrowsingData.${method}`))
          : Effect.fail(
              makeHostProtocolInternalError(
                `browsing data permission registry failure: ${error._tag}`,
                `BrowsingData.${method}`
              )
            )
      )
    )

const publishEvent = (
  pubsub: PubSub.PubSub<BrowsingDataEvent>,
  clock: Clock.Clock,
  profile: SessionProfileHandle,
  result: BrowsingDataClearResult
): Effect.Effect<void, never, never> =>
  PubSub.publish(
    pubsub,
    new BrowsingDataEvent({
      type: "browsing-data-event",
      timestamp: clock.currentTimeMillisUnsafe(),
      phase: "cleared",
      profile,
      cleared: result.cleared,
      unsupported: result.unsupported
    })
  ).pipe(Effect.asVoid)

const capability = (method: "clear" | "estimate" | "listTypes") =>
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
  failure: BrowsingDataError | undefined,
  effect: Effect.Effect<A, BrowsingDataError, never>
): Effect.Effect<A, BrowsingDataError, never> =>
  failure === undefined ? effect : Effect.fail(failure)
