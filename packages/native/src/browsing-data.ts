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
  type BrowsingDataType,
  type BrowsingDataClearOptions,
  BrowsingDataClearInput,
  BrowsingDataClearResult,
  BrowsingDataEvent,
  BrowsingDataListTypesResult,
  BrowsingDataSupportedResult
} from "./contracts/browsing-data.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/browsing-data.js"

const Surface = "BrowsingData"
const UnsupportedReason = "host-browsing-data-unavailable"
const EventMethod = "BrowsingData.Event"
const PortableBrowsingDataTypes = Object.freeze([
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
  support: NativeSurface.support.supported
})

export const BrowsingDataListTypes = NativeSurface.rpc(Surface, "listTypes", {
  payload: Schema.Void,
  success: BrowsingDataListTypesResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["listTypes"] })
  ),
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const BrowsingDataIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: BrowsingDataSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const browsingDataCapabilityFact = (method: "estimate") =>
  NativeSurface.capabilityFact(Surface, method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: [method] })
    ),
    support: UnsupportedSupport
  })

export const BrowsingDataCapabilityFacts = Object.freeze([browsingDataCapabilityFact("estimate")])

export const BrowsingDataRpcEvents = Object.freeze({
  Event: { payload: BrowsingDataEvent }
})

const BrowsingDataRpcGroup = RpcGroup.make(
  BrowsingDataClear,
  BrowsingDataListTypes,
  BrowsingDataIsSupported
)

export const BrowsingDataRpcs: RpcGroup.RpcGroup<BrowsingDataRpc> = BrowsingDataRpcGroup

export const BrowsingDataMethodNames = Object.freeze(["clear", "listTypes"] as const)

export interface BrowsingDataClientApi {
  readonly clear: (
    input: BrowsingDataClearOptions
  ) => Effect.Effect<BrowsingDataClearResult, BrowsingDataError, never>
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
    input: BrowsingDataClearOptions
  ) => Effect.Effect<BrowsingDataClearResult, BrowsingDataError, never>
  readonly listTypes: () => Effect.Effect<BrowsingDataListTypesResult, BrowsingDataError, never>
  readonly isSupported: () => Effect.Effect<BrowsingDataSupportedResult, BrowsingDataError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<BrowsingDataEvent, BrowsingDataError, never>
}

export class BrowsingData extends Context.Service<BrowsingData, BrowsingDataServiceApi>()(
  "@effect-desktop/native/BrowsingData"
) {
  static readonly layer = Layer.effect(BrowsingData)(
    Effect.gen(function* () {
      const client = yield* BrowsingDataClient
      return makeBrowsingDataService(client)
    })
  )
}

export const BrowsingDataLive = BrowsingData.layer

export const makeBrowsingDataClientLayer = (
  client: BrowsingDataClientApi
): Layer.Layer<BrowsingDataClient> => Layer.succeed(BrowsingDataClient)(client)

export const makeBrowsingDataServiceLayer = (
  client: BrowsingDataClientApi
): Layer.Layer<BrowsingData> => Layer.succeed(BrowsingData)(makeBrowsingDataService(client))

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
      return yield* browsingData.clear(input)
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
  capabilities: BrowsingDataMethodNames,
  handlers: BrowsingDataHandlersLive,
  capabilityFacts: BrowsingDataCapabilityFacts,
  client: (client) => browsingDataClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => browsingDataClientFromRpcClient(client, exchange)
})

export const makeHostBrowsingDataRpcRuntime = (
  handlers: BrowsingDataRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  BrowsingDataSurface.hostRuntime(handlers, runtimeOptions)

export const makeBrowsingDataMemoryClient = (): Effect.Effect<
  BrowsingDataClientApi,
  never,
  never
> =>
  Effect.succeed(
    Object.freeze({
      clear: (input) =>
        decodeBrowsingDataClearInput(input, "BrowsingData.clear").pipe(
          Effect.map(
            (valid) =>
              new BrowsingDataClearResult({ cleared: Array.from(valid.types), unsupported: [] })
          )
        ),
      listTypes: () =>
        Effect.succeed(
          new BrowsingDataListTypesResult({ types: Array.from(PortableBrowsingDataTypes) })
        ),
      isSupported: () => Effect.succeed(new BrowsingDataSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies BrowsingDataClientApi)
  )

export const makeBrowsingDataUnsupportedClient = (): BrowsingDataClientApi =>
  Object.freeze({
    clear: () => Effect.fail(unsupportedError("BrowsingData.clear")),
    listTypes: () => Effect.fail(unsupportedError("BrowsingData.listTypes")),
    isSupported: () =>
      Effect.succeed(
        new BrowsingDataSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies BrowsingDataClientApi)

const makeBrowsingDataService = (client: BrowsingDataClientApi): BrowsingDataServiceApi =>
  Object.freeze({
    clear: (input) => client.clear(input),
    listTypes: () => client.listTypes(),
    isSupported: () => client.isSupported(),
    events: (profile) => client.events(profile)
  } satisfies BrowsingDataServiceApi)

const browsingDataClientFromRpcClient = (
  client: DesktopRpcClient<BrowsingDataRpc>,
  exchange: BridgeClientExchange | undefined
): BrowsingDataClientApi =>
  Object.freeze({
    clear: (input) =>
      decodeBrowsingDataClearInput(input, "BrowsingData.clear").pipe(
        Effect.flatMap((decoded) =>
          runBrowsingDataRpc(client["BrowsingData.clear"](decoded), "BrowsingData.clear")
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

const decodeBrowsingDataClearInput = (
  input: unknown,
  operation: string
): Effect.Effect<BrowsingDataClearInput, BrowsingDataError, never> =>
  decodeNativeInput(BrowsingDataClearInput, input, operation)

const runBrowsingDataRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, BrowsingDataError, never> => runNativeRpc(effect, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: UnsupportedReason,
    operation,
    recoverable: false
  })
