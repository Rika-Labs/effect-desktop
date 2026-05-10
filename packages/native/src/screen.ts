import {
  Api,
  Client,
  type ApiClientExchange,
  type ApiClientOptions,
  type ApiContractClass,
  type ApiContractError,
  type ApiContractSpec,
  type ApiHandlers,
  type ApiLayer,
  makeHostProtocolInvalidOutputError,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Option, Schema } from "effect"

import {
  ScreenDisplay,
  ScreenDisplaysResult,
  ScreenIsSupportedInput,
  type ScreenMethod,
  ScreenPoint,
  ScreenSupportedResult
} from "./contracts/screen.js"

export type ScreenError = HostProtocolError

export const ScreenApiSpec = Object.freeze({
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
}) satisfies ApiContractSpec

export type ScreenApiSpec = typeof ScreenApiSpec

export const ScreenApiEvents = Object.freeze({})

export type ScreenApiEvents = typeof ScreenApiEvents

export const ScreenApi: ApiContractClass<"Screen", ScreenApiSpec, ScreenApiEvents> = (() => {
  const contract = class {
    static readonly tag = "Screen"
    static readonly spec = ScreenApiSpec
    static readonly events = ScreenApiEvents

    static layer<Handlers extends ApiHandlers<ScreenApiSpec>>(
      handlers: Handlers
    ): ApiLayer<"Screen", ScreenApiSpec, Handlers, ScreenApiEvents> {
      return Object.freeze({ contract, handlers: Object.freeze(handlers) })
    }
  } as ApiContractClass<"Screen", ScreenApiSpec, ScreenApiEvents>

  return Object.freeze(contract)
})()

export const registerScreenApi = (): Effect.Effect<
  ApiContractClass<"Screen", ScreenApiSpec, ScreenApiEvents>,
  ApiContractError,
  never
> =>
  Effect.gen(function* () {
    const existing = yield* Api.get("Screen")
    if (Option.isSome(existing)) {
      return existing.value as ApiContractClass<"Screen", ScreenApiSpec, ScreenApiEvents>
    }
    return yield* Api.Tag("Screen")<unknown>()(ScreenApiSpec, ScreenApiEvents)
  })

export const ScreenMethodNames = Object.freeze(
  Object.keys(ScreenApiSpec) as ReadonlyArray<keyof ScreenApiSpec>
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
  exchange: ApiClientExchange,
  options: ApiClientOptions = {}
): Layer.Layer<ScreenClient> =>
  Layer.succeed(ScreenClient)(makeScreenBridgeClient(exchange, options))

export const makeHostScreenApiLayer = <Handlers extends ApiHandlers<ScreenApiSpec>>(
  handlers: Handlers
): ApiLayer<"Screen", ScreenApiSpec, Handlers, ScreenApiEvents> => ScreenApi.layer(handlers)

const makeScreenBridgeClient = (
  exchange: ApiClientExchange,
  options: ApiClientOptions
): ScreenClientApi => {
  const client = Client({ Screen: ScreenApi }, exchange, options).Screen
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
