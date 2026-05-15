import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  makeDesktopClientProtocol,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  Rpc,
  RpcClient,
  RpcCapability,
  RpcGroup,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidOutputError,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolRequestEnvelope,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { type PermissionRegistry, P, DesktopRpc, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema } from "effect"

import { makeNativeHostRpcRuntime } from "./native-rpc-runtime.js"
import {
  ScreenDisplay,
  ScreenDisplaysResult,
  ScreenIsSupportedInput,
  type ScreenMethod,
  ScreenPoint,
  ScreenSupportedResult
} from "./contracts/screen.js"

export type ScreenError = HostProtocolError

export const ScreenGetDisplays = Rpc.make("Screen.getDisplays", {
  payload: Schema.Void,
  success: ScreenDisplaysResult,
  error: HostProtocolErrorSchema
}).pipe(RpcCapability(P.nativeInvoke({ primitive: "Screen", methods: ["getDisplays"] })))

export const ScreenGetPrimaryDisplay = Rpc.make("Screen.getPrimaryDisplay", {
  payload: Schema.Void,
  success: ScreenDisplay,
  error: HostProtocolErrorSchema
}).pipe(RpcCapability(P.nativeInvoke({ primitive: "Screen", methods: ["getPrimaryDisplay"] })))

export const ScreenGetPointerPoint = Rpc.make("Screen.getPointerPoint", {
  payload: Schema.Void,
  success: ScreenPoint,
  error: HostProtocolErrorSchema
}).pipe(RpcCapability(P.nativeInvoke({ primitive: "Screen", methods: ["getPointerPoint"] })))

export const ScreenIsSupported = Rpc.make("Screen.isSupported", {
  payload: ScreenIsSupportedInput,
  success: ScreenSupportedResult,
  error: HostProtocolErrorSchema
}).pipe(RpcCapability({ kind: "none" }))

const makeScreenRpcGroup = () =>
  RpcGroup.make(
    ScreenGetDisplays,
    ScreenGetPrimaryDisplay,
    ScreenGetPointerPoint,
    ScreenIsSupported
  )

const ScreenRpcGroup = makeScreenRpcGroup()

export const ScreenRpcs: RpcGroup.RpcGroup<ScreenRpc> = ScreenRpcGroup

export type ScreenRpc = RpcGroup.Rpcs<typeof ScreenRpcGroup>

export type ScreenBridgeClientOptions = Omit<BridgeClientOptions, "nextRequestId">

export const ScreenMethodNames = Object.freeze([
  "getDisplays",
  "getPrimaryDisplay",
  "getPointerPoint",
  "isSupported"
] as const)

export interface ScreenClientApi {
  readonly getDisplays: () => Effect.Effect<ScreenDisplaysResult, ScreenError, never>
  readonly getPrimaryDisplay: () => Effect.Effect<ScreenDisplay, ScreenError, never>
  readonly getPointerPoint: () => Effect.Effect<ScreenPoint, ScreenError, never>
  readonly isSupported: (
    method: ScreenMethod
  ) => Effect.Effect<ScreenSupportedResult, ScreenError, never>
}

export class ScreenClient extends Context.Service<ScreenClient, ScreenClientApi>()(
  "@effect-desktop/native/ScreenClient"
) {}

export interface ScreenServiceApi {
  readonly getDisplays: () => Effect.Effect<ReadonlyArray<ScreenDisplay>, ScreenError, never>
  readonly getPrimaryDisplay: () => Effect.Effect<ScreenDisplay, ScreenError, never>
  readonly getPointerPoint: () => Effect.Effect<ScreenPoint, ScreenError, never>
  readonly isSupported: (method: ScreenMethod) => Effect.Effect<boolean, ScreenError, never>
}

export class Screen extends Context.Service<Screen, ScreenServiceApi>()(
  "@effect-desktop/native/Screen"
) {}

export const ScreenLive = Layer.effect(Screen)(
  Effect.gen(function* () {
    const client = yield* ScreenClient
    return Object.freeze({
      getDisplays: () => client.getDisplays().pipe(Effect.map((result) => result.displays)),
      getPrimaryDisplay: () => client.getPrimaryDisplay(),
      getPointerPoint: () => client.getPointerPoint(),
      isSupported: (method) =>
        client.isSupported(method).pipe(Effect.map((result) => result.supported))
    } satisfies ScreenServiceApi)
  })
)

export const ScreenHandlersLive = ScreenRpcGroup.toLayer({
  "Screen.getDisplays": () =>
    Effect.gen(function* () {
      const screen = yield* Screen
      const displays = yield* screen.getDisplays()
      return new ScreenDisplaysResult({ displays })
    }),
  "Screen.getPrimaryDisplay": () =>
    Effect.gen(function* () {
      const screen = yield* Screen
      return yield* screen.getPrimaryDisplay()
    }),
  "Screen.getPointerPoint": () =>
    Effect.gen(function* () {
      const screen = yield* Screen
      return yield* screen.getPointerPoint()
    }),
  "Screen.isSupported": (input) =>
    Effect.gen(function* () {
      const screen = yield* Screen
      const supported = yield* screen.isSupported(input.method)
      return new ScreenSupportedResult({ supported })
    })
})

export const ScreenSurface = DesktopRpc.surface("Screen", ScreenRpcGroup, {
  service: ScreenClient,
  handlers: ScreenHandlersLive,
  client: (client) => screenClientFromRpcClient(client)
})

export const makeScreenClientLayer = (client: ScreenClientApi): Layer.Layer<ScreenClient> =>
  Layer.succeed(ScreenClient)(client)

export const makeScreenServiceLayer = (client: ScreenClientApi): Layer.Layer<Screen> =>
  Layer.provide(ScreenLive, makeScreenClientLayer(client))

export const makeScreenBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: ScreenBridgeClientOptions = {}
): Layer.Layer<ScreenClient> =>
  Layer.provide(ScreenSurface.clientLayer, makeScreenBridgeProtocolLayer(exchange, options))

export type ScreenRpcHandlers = Parameters<typeof ScreenRpcGroup.toLayer>[0]

export const makeHostScreenRpcRuntime = (
  handlers: ScreenRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  makeNativeHostRpcRuntime(ScreenRpcGroup, ScreenRpcGroup.toLayer(handlers), runtimeOptions)

const makeScreenBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: ScreenBridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, {
      ...options,
      normalizeRequest: normalizeScreenBridgeRequest
    }).pipe(Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options)))
  )

const normalizeScreenBridgeRequest = (
  request: HostProtocolRequestEnvelope
): HostProtocolRequestEnvelope => {
  if (
    request.payload !== null ||
    (request.method !== "Screen.getDisplays" &&
      request.method !== "Screen.getPrimaryDisplay" &&
      request.method !== "Screen.getPointerPoint")
  ) {
    return request
  }
  return new HostProtocolRequestEnvelope({
    kind: "request",
    id: request.id,
    method: request.method,
    timestamp: request.timestamp,
    traceId: request.traceId,
    ...(request.windowId === undefined ? {} : { windowId: request.windowId }),
    ...(request.originToken === undefined ? {} : { originToken: request.originToken })
  })
}

const screenClientFromRpcClient = (client: DesktopRpcClient<ScreenRpc>): ScreenClientApi =>
  Object.freeze({
    getDisplays: () =>
      runScreenRpc(client["Screen.getDisplays"](undefined)).pipe(
        Effect.flatMap(validateScreenDisplays)
      ),
    getPrimaryDisplay: () => runScreenRpc(client["Screen.getPrimaryDisplay"](undefined)),
    getPointerPoint: () => runScreenRpc(client["Screen.getPointerPoint"](undefined)),
    isSupported: (method) =>
      runScreenRpc(client["Screen.isSupported"](new ScreenIsSupportedInput({ method })))
  } satisfies ScreenClientApi)

const runScreenRpc = <A, E>(
  effect: Effect.Effect<A, E, never>
): Effect.Effect<A, ScreenError, never> => effect.pipe(Effect.mapError(mapScreenRpcClientError))

const mapScreenRpcClientError = (error: unknown): ScreenError =>
  isScreenError(error) ? error : makeHostProtocolInternalError("Screen RPC client failed", "Screen")

const isScreenError = (error: unknown): error is ScreenError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const validateScreenDisplays = (
  result: ScreenDisplaysResult
): Effect.Effect<ScreenDisplaysResult, ScreenError, never> => {
  const primaryCount = result.displays.filter((display) => display.primary).length
  if (result.displays.length === 0) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(
        "Screen.getDisplays",
        "getDisplays payload must include at least one display"
      )
    )
  }
  if (primaryCount !== 1) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(
        "Screen.getDisplays",
        "getDisplays payload must include exactly one primary display"
      )
    )
  }
  return Effect.succeed(result)
}
