import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  HostProtocolInternalError,
  HostProtocolUnsupportedError,
  RpcGroup
} from "@orika/bridge"
import { type DesktopRpcClient, P, type PermissionRegistry } from "@orika/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import {
  TransientWindowRoleEvent,
  TransientWindowRoleSupportedResult
} from "./contracts/transient-window-role.js"
import { runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/transient-window-role.js"

const Surface = "TransientWindowRole"
const UnsupportedReason = "host-adapter-unimplemented"
const EventMethod = "TransientWindowRole.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type TransientWindowRoleError = HostProtocolError

export const TransientWindowRoleIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: TransientWindowRoleSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const transientWindowRoleCapabilityFact = (method: "open" | "reposition" | "dismiss") =>
  NativeSurface.capabilityFact(Surface, method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: [method] })
    ),
    support: UnsupportedSupport
  })

export const TransientWindowRoleCapabilityFacts = Object.freeze([
  transientWindowRoleCapabilityFact("open"),
  transientWindowRoleCapabilityFact("reposition"),
  transientWindowRoleCapabilityFact("dismiss")
])

const TransientWindowRoleRpcGroup = RpcGroup.make(TransientWindowRoleIsSupported)

export type TransientWindowRoleRpc = RpcGroup.Rpcs<typeof TransientWindowRoleRpcGroup>
export type TransientWindowRoleRpcHandlers = RpcGroup.HandlersFrom<TransientWindowRoleRpc>
export const TransientWindowRoleRpcs: RpcGroup.RpcGroup<TransientWindowRoleRpc> =
  TransientWindowRoleRpcGroup

export const TransientWindowRoleRpcEvents = Object.freeze({
  Event: { payload: TransientWindowRoleEvent }
})

export const TransientWindowRoleMethodNames = Object.freeze(["isSupported"] as const)

export interface TransientWindowRoleClientApi {
  readonly isSupported: () => Effect.Effect<
    TransientWindowRoleSupportedResult,
    TransientWindowRoleError,
    never
  >
  readonly events: () => Stream.Stream<TransientWindowRoleEvent, TransientWindowRoleError, never>
}

export class TransientWindowRoleClient extends Context.Service<
  TransientWindowRoleClient,
  TransientWindowRoleClientApi
>()("@orika/native/TransientWindowRoleClient") {}

export interface TransientWindowRoleServiceApi extends TransientWindowRoleClientApi {}

export class TransientWindowRole extends Context.Service<
  TransientWindowRole,
  TransientWindowRoleServiceApi
>()("@orika/native/TransientWindowRole") {
  static readonly layer = Layer.effect(TransientWindowRole)(
    Effect.gen(function* () {
      const client = yield* TransientWindowRoleClient
      return makeTransientWindowRoleService(client)
    })
  )
}

export const TransientWindowRoleLive = TransientWindowRole.layer

export const makeTransientWindowRoleClientLayer = (
  client: TransientWindowRoleClientApi
): Layer.Layer<TransientWindowRoleClient> => Layer.succeed(TransientWindowRoleClient)(client)

export const makeTransientWindowRoleServiceLayer = (
  client: TransientWindowRoleClientApi
): Layer.Layer<TransientWindowRole> =>
  Layer.succeed(TransientWindowRole, makeTransientWindowRoleService(client))

export const makeTransientWindowRoleBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<TransientWindowRoleClient> =>
  TransientWindowRoleSurface.bridgeClientLayer(exchange, options)

export const TransientWindowRoleHandlersLive = TransientWindowRoleRpcGroup.toLayer({
  "TransientWindowRole.isSupported": () =>
    Effect.gen(function* () {
      const service = yield* TransientWindowRole
      return yield* service.isSupported()
    })
})

export const TransientWindowRoleSurface = NativeSurface.make(Surface, TransientWindowRoleRpcGroup, {
  service: TransientWindowRoleClient,
  handlers: TransientWindowRoleHandlersLive,
  capabilityFacts: TransientWindowRoleCapabilityFacts,
  client: (client) => transientWindowRoleClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => transientWindowRoleClientFromRpcClient(client, exchange)
})

export const makeHostTransientWindowRoleRpcRuntime = (
  handlers: TransientWindowRoleRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  TransientWindowRoleSurface.hostRuntime(handlers, runtimeOptions)

export const makeTransientWindowRoleMemoryClient = (): Effect.Effect<
  TransientWindowRoleClientApi,
  never,
  never
> =>
  Effect.succeed(
    Object.freeze({
      isSupported: () =>
        Effect.succeed(new TransientWindowRoleSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies TransientWindowRoleClientApi)
  )

export const makeTransientWindowRoleUnsupportedClient = (): TransientWindowRoleClientApi =>
  Object.freeze({
    isSupported: () =>
      Effect.succeed(
        new TransientWindowRoleSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies TransientWindowRoleClientApi)

const makeTransientWindowRoleService = (
  client: TransientWindowRoleClientApi
): TransientWindowRoleServiceApi =>
  Object.freeze({
    isSupported: () => client.isSupported(),
    events: () => client.events()
  } satisfies TransientWindowRoleServiceApi)

const transientWindowRoleClientFromRpcClient = (
  client: DesktopRpcClient<TransientWindowRoleRpc>,
  _exchange: BridgeClientExchange | undefined
): TransientWindowRoleClientApi =>
  Object.freeze({
    isSupported: () =>
      runTransientWindowRoleRpc(
        client["TransientWindowRole.isSupported"](undefined),
        "TransientWindowRole.isSupported"
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies TransientWindowRoleClientApi)

const runTransientWindowRoleRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, TransientWindowRoleError, never> =>
  runNativeRpc(effect, operation, Surface).pipe(Effect.mapError(narrowTransientWindowRoleError))

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported TransientWindowRole method: ${operation}`,
    operation,
    recoverable: false
  })

const narrowTransientWindowRoleError = (error: HostProtocolError): TransientWindowRoleError => {
  if (
    error.tag === "PermissionDenied" ||
    error.tag === "PermissionRevoked" ||
    error.tag === "Unsupported" ||
    error.tag === "InvalidArgument" ||
    error.tag === "InvalidOutput" ||
    error.tag === "Internal"
  ) {
    return error
  }
  return new HostProtocolInternalError({
    tag: "Internal",
    message: `unexpected transient window role host failure: ${error.tag}`,
    operation: error.operation,
    recoverable: false
  })
}
