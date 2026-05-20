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

import {
  SelectionContextEvent,
  SelectionContextSupportedResult
} from "./contracts/selection-context.js"
import { runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/selection-context.js"

const Surface = "SelectionContext"
const UnsupportedReason = "host-adapter-unimplemented"
const SelectionContextEventMethod = "SelectionContext.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type SelectionContextError = HostProtocolError

export const SelectionContextIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: SelectionContextSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const selectionContextCapabilityFact = (
  method: "readSelection" | "readDocumentContext" | "watchFocus" | "stopWatching"
) =>
  NativeSurface.capabilityFact(Surface, method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: [method] })
    ),
    support: UnsupportedSupport
  })

export const SelectionContextCapabilityFacts = Object.freeze([
  selectionContextCapabilityFact("readSelection"),
  selectionContextCapabilityFact("readDocumentContext"),
  selectionContextCapabilityFact("watchFocus"),
  selectionContextCapabilityFact("stopWatching")
])

export const SelectionContextRpcEvents = Object.freeze({
  Event: { payload: SelectionContextEvent }
})

const SelectionContextRpcGroup = RpcGroup.make(SelectionContextIsSupported)

export const SelectionContextRpcs: RpcGroup.RpcGroup<SelectionContextRpc> = SelectionContextRpcGroup

export const SelectionContextMethodNames = Object.freeze(["isSupported"] as const)

export interface SelectionContextClientApi {
  readonly isSupported: () => Effect.Effect<
    SelectionContextSupportedResult,
    SelectionContextError,
    never
  >
  readonly events: () => Stream.Stream<SelectionContextEvent, SelectionContextError, never>
}

export class SelectionContextClient extends Context.Service<
  SelectionContextClient,
  SelectionContextClientApi
>()("@orika/native/SelectionContextClient") {}

export interface SelectionContextServiceApi {
  readonly isSupported: () => Effect.Effect<
    SelectionContextSupportedResult,
    SelectionContextError,
    never
  >
  readonly events: () => Stream.Stream<SelectionContextEvent, SelectionContextError, never>
}

export class SelectionContext extends Context.Service<
  SelectionContext,
  SelectionContextServiceApi
>()("@orika/native/SelectionContext") {
  static readonly layer = Layer.effect(SelectionContext)(
    Effect.gen(function* () {
      const client = yield* SelectionContextClient
      return makeSelectionContextService(client)
    })
  )
}

export const SelectionContextLive = SelectionContext.layer

export const makeSelectionContextClientLayer = (
  client: SelectionContextClientApi
): Layer.Layer<SelectionContextClient> => Layer.succeed(SelectionContextClient)(client)

export const makeSelectionContextServiceLayer = (
  client: SelectionContextClientApi
): Layer.Layer<SelectionContext> =>
  Layer.succeed(SelectionContext)(makeSelectionContextService(client))

export const makeSelectionContextBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<SelectionContextClient> =>
  SelectionContextSurface.bridgeClientLayer(exchange, options)

export type SelectionContextRpc = RpcGroup.Rpcs<typeof SelectionContextRpcGroup>
export type SelectionContextRpcHandlers = RpcGroup.HandlersFrom<SelectionContextRpc>

export const SelectionContextHandlersLive = SelectionContextRpcGroup.toLayer({
  "SelectionContext.isSupported": () =>
    Effect.gen(function* () {
      const service = yield* SelectionContext
      return yield* service.isSupported()
    })
})

export const SelectionContextSurface = NativeSurface.make(Surface, SelectionContextRpcGroup, {
  service: SelectionContextClient,
  handlers: SelectionContextHandlersLive,
  capabilityFacts: SelectionContextCapabilityFacts,
  client: (client) => selectionContextClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => selectionContextClientFromRpcClient(client, exchange)
})

export const makeHostSelectionContextRpcRuntime = (
  handlers: SelectionContextRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  SelectionContextSurface.hostRuntime(handlers, runtimeOptions)

export const makeSelectionContextMemoryClient = (): Effect.Effect<
  SelectionContextClientApi,
  never,
  never
> =>
  Effect.succeed(
    Object.freeze({
      isSupported: () => Effect.succeed(new SelectionContextSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies SelectionContextClientApi)
  )

export const makeSelectionContextUnsupportedClient = (): SelectionContextClientApi =>
  Object.freeze({
    isSupported: () =>
      Effect.succeed(
        new SelectionContextSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(SelectionContextEventMethod))
  } satisfies SelectionContextClientApi)

const makeSelectionContextService = (
  client: SelectionContextClientApi
): SelectionContextServiceApi =>
  Object.freeze({
    isSupported: () => client.isSupported(),
    events: () => client.events()
  } satisfies SelectionContextServiceApi)

const selectionContextClientFromRpcClient = (
  client: DesktopRpcClient<SelectionContextRpc>,
  _exchange: BridgeClientExchange | undefined
): SelectionContextClientApi =>
  Object.freeze({
    isSupported: () =>
      runSelectionContextRpc(
        client["SelectionContext.isSupported"](undefined),
        "SelectionContext.isSupported"
      ),
    events: () => Stream.fail(unsupportedError(SelectionContextEventMethod))
  } satisfies SelectionContextClientApi)

const runSelectionContextRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, SelectionContextError, never> => runNativeRpc(effect, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported SelectionContext method: ${operation}`,
    operation,
    recoverable: false
  })
