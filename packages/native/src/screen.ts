import {
  BridgeRpc,
  Client,
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeRpcGroup,
  type BridgeRpcSpec,
  type BridgeRpcHandlers,
  type BridgeRpcLayer,
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

export const ScreenRpcSpec = Object.freeze({
  getDisplays: screenMethodSpec(
    Schema.Void,
    ScreenDisplaysResult,
    "native.invoke:Screen.getDisplays"
  ),
  getPrimaryDisplay: screenMethodSpec(
    Schema.Void,
    ScreenDisplay,
    "native.invoke:Screen.getPrimaryDisplay"
  ),
  getPointerPoint: screenMethodSpec(
    Schema.Void,
    ScreenPoint,
    "native.invoke:Screen.getPointerPoint"
  ),
  isSupported: {
    input: ScreenIsSupportedInput,
    output: ScreenSupportedResult,
    error: HostProtocolErrorSchema,
    permission: "none"
  }
}) satisfies BridgeRpcSpec

export type ScreenRpcSpec = typeof ScreenRpcSpec

export const ScreenRpcEvents = Object.freeze({})

export type ScreenRpcEvents = typeof ScreenRpcEvents

export const ScreenRpcs: BridgeRpcGroup<"Screen", ScreenRpcSpec, ScreenRpcEvents> = BridgeRpc.group(
  "Screen",
  ScreenRpcSpec,
  ScreenRpcEvents
)

export const ScreenMethodNames = Object.freeze(
  Object.keys(ScreenRpcSpec) as ReadonlyArray<keyof ScreenRpcSpec>
)

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

export const makeHostScreenBridgeRpcLayer = <Handlers extends BridgeRpcHandlers<ScreenRpcSpec>>(
  handlers: Handlers
): BridgeRpcLayer<"Screen", ScreenRpcSpec, Handlers, ScreenRpcEvents> =>
  BridgeRpc.layer(ScreenRpcs)(handlers)

const makeScreenBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): ScreenClientApi => {
  const client = Client({ Screen: ScreenRpcs }, exchange, options).Screen
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

function screenMethodSpec<
  Input extends Schema.Schema<unknown>,
  Output extends Schema.Schema<unknown>
>(input: Input, output: Output, permission: string) {
  return { input, output, error: HostProtocolErrorSchema, permission } as const
}
