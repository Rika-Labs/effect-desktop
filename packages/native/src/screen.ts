import {
  BridgeRpc,
  Client,
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeRpcHandlers,
  type BridgeRpcLayer,
  Rpc,
  RpcCapability,
  RpcGroup,
  makeHostProtocolInvalidOutputError,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Schema } from "effect"

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
}).pipe(RpcCapability({ kind: "native.invoke:Screen.getDisplays" }))

export const ScreenGetPrimaryDisplay = Rpc.make("Screen.getPrimaryDisplay", {
  payload: Schema.Void,
  success: ScreenDisplay,
  error: HostProtocolErrorSchema
}).pipe(RpcCapability({ kind: "native.invoke:Screen.getPrimaryDisplay" }))

export const ScreenGetPointerPoint = Rpc.make("Screen.getPointerPoint", {
  payload: Schema.Void,
  success: ScreenPoint,
  error: HostProtocolErrorSchema
}).pipe(RpcCapability({ kind: "native.invoke:Screen.getPointerPoint" }))

export const ScreenIsSupported = Rpc.make("Screen.isSupported", {
  payload: ScreenIsSupportedInput,
  success: ScreenSupportedResult,
  error: HostProtocolErrorSchema
}).pipe(RpcCapability({ kind: "none" }))

export const ScreenRpcEvents = Object.freeze({})

export type ScreenRpcEvents = typeof ScreenRpcEvents

const ScreenRpcGroup = RpcGroup.make(
  ScreenGetDisplays,
  ScreenGetPrimaryDisplay,
  ScreenGetPointerPoint,
  ScreenIsSupported
)

export const ScreenRpcs = BridgeRpc.fromGroup("Screen", ScreenRpcGroup, ScreenRpcEvents)

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

export const makeScreenClientLayer = (client: ScreenClientApi): Layer.Layer<ScreenClient> =>
  Layer.succeed(ScreenClient)(client)

export const makeScreenServiceLayer = (client: ScreenClientApi): Layer.Layer<Screen> =>
  Layer.provide(ScreenLive, makeScreenClientLayer(client))

export const makeScreenBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<ScreenClient> =>
  Layer.succeed(ScreenClient)(makeScreenBridgeClient(exchange, options))

export type ScreenRpcSpec = (typeof ScreenRpcs)["spec"]

export const makeHostScreenBridgeRpcLayer = <Handlers extends BridgeRpcHandlers<ScreenRpcSpec>>(
  handlers: Handlers
): BridgeRpcLayer<"Screen", ScreenRpcSpec, Handlers, ScreenRpcEvents> =>
  BridgeRpc.layer(ScreenRpcs)(handlers)

const makeScreenBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): ScreenClientApi => {
  const client = Client({ Screen: ScreenRpcs }, exchange, options).Screen as unknown as {
    readonly getDisplays: () => Effect.Effect<ScreenDisplaysResult, ScreenError, never>
    readonly getPrimaryDisplay: () => Effect.Effect<ScreenDisplay, ScreenError, never>
    readonly getPointerPoint: () => Effect.Effect<ScreenPoint, ScreenError, never>
    readonly isSupported: (
      input: ScreenIsSupportedInput
    ) => Effect.Effect<ScreenSupportedResult, ScreenError, never>
  }
  return Object.freeze({
    getDisplays: () => client.getDisplays().pipe(Effect.flatMap(validateScreenDisplays)),
    getPrimaryDisplay: () => client.getPrimaryDisplay(),
    getPointerPoint: () => client.getPointerPoint(),
    isSupported: (method) => client.isSupported(new ScreenIsSupportedInput({ method }))
  } satisfies ScreenClientApi)
}

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

export const makeUnsupportedScreenClient = (): ScreenClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, ScreenError, never> =>
    Effect.fail(unsupportedError(method))
  return Object.freeze({
    getDisplays: () => unsupportedEffect<ScreenDisplaysResult>("Screen.getDisplays"),
    getPrimaryDisplay: () => unsupportedEffect<ScreenDisplay>("Screen.getPrimaryDisplay"),
    getPointerPoint: () => unsupportedEffect<ScreenPoint>("Screen.getPointerPoint"),
    isSupported: () => Effect.succeed(new ScreenSupportedResult({ supported: false }))
  } satisfies ScreenClientApi)
}

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "host Screen platform adapter is not implemented yet",
    message: `unsupported Screen method: ${method}`,
    operation: method,
    recoverable: false
  })
