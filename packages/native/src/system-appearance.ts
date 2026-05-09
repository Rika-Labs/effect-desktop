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
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"

import {
  type SystemAppearanceColor,
  SystemAppearanceAccentColorResult,
  SystemAppearanceBooleanResult,
  SystemAppearanceChangedEvent,
  SystemAppearanceIsSupportedInput,
  type SystemAppearanceMethod,
  type SystemAppearanceMode,
  SystemAppearanceResult,
  SystemAppearanceSupportedResult
} from "./contracts/system-appearance.js"

export type SystemAppearanceError = HostProtocolError

export const SystemAppearanceApiSpec = Object.freeze({
  getAppearance: systemAppearanceMethodSpec(
    Schema.Void,
    SystemAppearanceResult,
    "native.invoke:SystemAppearance.getAppearance"
  ),
  getAccentColor: systemAppearanceMethodSpec(
    Schema.Void,
    SystemAppearanceAccentColorResult,
    "native.invoke:SystemAppearance.getAccentColor"
  ),
  getReducedMotion: systemAppearanceMethodSpec(
    Schema.Void,
    SystemAppearanceBooleanResult,
    "native.invoke:SystemAppearance.getReducedMotion"
  ),
  getReducedTransparency: systemAppearanceMethodSpec(
    Schema.Void,
    SystemAppearanceBooleanResult,
    "native.invoke:SystemAppearance.getReducedTransparency"
  ),
  isSupported: {
    input: SystemAppearanceIsSupportedInput,
    output: SystemAppearanceSupportedResult,
    error: HostProtocolErrorSchema,
    permission: "none"
  }
}) satisfies ApiContractSpec

export type SystemAppearanceApiSpec = typeof SystemAppearanceApiSpec

export const SystemAppearanceApiEvents = Object.freeze({
  AppearanceChanged: { payload: SystemAppearanceChangedEvent }
})

export type SystemAppearanceApiEvents = typeof SystemAppearanceApiEvents

export const SystemAppearanceApi: ApiContractClass<
  "SystemAppearance",
  SystemAppearanceApiSpec,
  SystemAppearanceApiEvents
> = (() => {
  const contract = class {
    static readonly tag = "SystemAppearance"
    static readonly spec = SystemAppearanceApiSpec
    static readonly events = SystemAppearanceApiEvents

    static layer<Handlers extends ApiHandlers<SystemAppearanceApiSpec>>(
      handlers: Handlers
    ): ApiLayer<"SystemAppearance", SystemAppearanceApiSpec, Handlers, SystemAppearanceApiEvents> {
      return Object.freeze({ contract, handlers: Object.freeze(handlers) })
    }
  } as ApiContractClass<"SystemAppearance", SystemAppearanceApiSpec, SystemAppearanceApiEvents>

  return Object.freeze(contract)
})()

export const registerSystemAppearanceApi = (): Effect.Effect<
  ApiContractClass<"SystemAppearance", SystemAppearanceApiSpec, SystemAppearanceApiEvents>,
  ApiContractError,
  never
> =>
  Effect.gen(function* () {
    const existing = yield* Api.get("SystemAppearance")
    if (Option.isSome(existing)) {
      return existing.value as ApiContractClass<
        "SystemAppearance",
        SystemAppearanceApiSpec,
        SystemAppearanceApiEvents
      >
    }
    return yield* Api.Tag("SystemAppearance")<unknown>()(
      SystemAppearanceApiSpec,
      SystemAppearanceApiEvents
    )
  })

export const SystemAppearanceMethodNames = Object.freeze(
  Object.keys(SystemAppearanceApiSpec) as ReadonlyArray<keyof SystemAppearanceApiSpec>
)

export interface SystemAppearanceClientApi {
  readonly getAppearance: () => Effect.Effect<SystemAppearanceResult, SystemAppearanceError, never>
  readonly getAccentColor: () => Effect.Effect<
    SystemAppearanceAccentColorResult,
    SystemAppearanceError,
    never
  >
  readonly getReducedMotion: () => Effect.Effect<
    SystemAppearanceBooleanResult,
    SystemAppearanceError,
    never
  >
  readonly getReducedTransparency: () => Effect.Effect<
    SystemAppearanceBooleanResult,
    SystemAppearanceError,
    never
  >
  readonly onAppearanceChanged: () => Stream.Stream<
    SystemAppearanceChangedEvent,
    SystemAppearanceError,
    never
  >
  readonly isSupported: (
    method: SystemAppearanceMethod
  ) => Effect.Effect<SystemAppearanceSupportedResult, SystemAppearanceError, never>
}

export class SystemAppearanceClient extends Context.Service<
  SystemAppearanceClient,
  SystemAppearanceClientApi
>()("@effect-desktop/native/SystemAppearanceClient") {}

export interface SystemAppearanceServiceApi {
  readonly getAppearance: () => Effect.Effect<SystemAppearanceMode, SystemAppearanceError, never>
  readonly getAccentColor: () => Effect.Effect<
    SystemAppearanceColor | null,
    SystemAppearanceError,
    never
  >
  readonly getReducedMotion: () => Effect.Effect<boolean, SystemAppearanceError, never>
  readonly getReducedTransparency: () => Effect.Effect<boolean, SystemAppearanceError, never>
  readonly onAppearanceChanged: () => Stream.Stream<
    SystemAppearanceChangedEvent,
    SystemAppearanceError,
    never
  >
  readonly isSupported: (
    method: SystemAppearanceMethod
  ) => Effect.Effect<boolean, SystemAppearanceError, never>
}

export class SystemAppearance extends Context.Service<
  SystemAppearance,
  SystemAppearanceServiceApi
>()("@effect-desktop/native/SystemAppearance") {}

export const SystemAppearanceLive = Layer.effect(SystemAppearance)(
  Effect.gen(function* () {
    const client = yield* SystemAppearanceClient
    return Object.freeze({
      getAppearance: () => client.getAppearance().pipe(Effect.map((result) => result.appearance)),
      getAccentColor: () => client.getAccentColor().pipe(Effect.map((result) => result.color)),
      getReducedMotion: () =>
        client.getReducedMotion().pipe(Effect.map((result) => result.enabled)),
      getReducedTransparency: () =>
        client.getReducedTransparency().pipe(Effect.map((result) => result.enabled)),
      onAppearanceChanged: () => client.onAppearanceChanged(),
      isSupported: (method) =>
        client.isSupported(method).pipe(Effect.map((result) => result.supported))
    } satisfies SystemAppearanceServiceApi)
  })
)

export const makeSystemAppearanceClientLayer = (
  client: SystemAppearanceClientApi
): Layer.Layer<SystemAppearanceClient> => Layer.succeed(SystemAppearanceClient)(client)

export const makeSystemAppearanceServiceLayer = (
  client: SystemAppearanceClientApi
): Layer.Layer<SystemAppearance> =>
  Layer.provide(SystemAppearanceLive, makeSystemAppearanceClientLayer(client))

export const makeSystemAppearanceBridgeClientLayer = (
  exchange: ApiClientExchange,
  options: ApiClientOptions = {}
): Layer.Layer<SystemAppearanceClient> =>
  Layer.succeed(SystemAppearanceClient)(makeSystemAppearanceBridgeClient(exchange, options))

export const makeHostSystemAppearanceApiLayer = <
  Handlers extends ApiHandlers<SystemAppearanceApiSpec>
>(
  handlers: Handlers
): ApiLayer<"SystemAppearance", SystemAppearanceApiSpec, Handlers, SystemAppearanceApiEvents> =>
  SystemAppearanceApi.layer(handlers)

const makeSystemAppearanceBridgeClient = (
  exchange: ApiClientExchange,
  options: ApiClientOptions
): SystemAppearanceClientApi => {
  const client = Client(
    { SystemAppearance: SystemAppearanceApi },
    exchange,
    options
  ).SystemAppearance
  return Object.freeze({
    getAppearance: () => client.getAppearance(),
    getAccentColor: () => client.getAccentColor(),
    getReducedMotion: () => client.getReducedMotion(),
    getReducedTransparency: () => client.getReducedTransparency(),
    onAppearanceChanged: () => client.events.AppearanceChanged,
    isSupported: (method) => client.isSupported(new SystemAppearanceIsSupportedInput({ method }))
  } satisfies SystemAppearanceClientApi)
}

export const makeUnsupportedSystemAppearanceClient = (): SystemAppearanceClientApi => {
  const unsupportedStream = <A>(method: string): Stream.Stream<A, SystemAppearanceError, never> =>
    Stream.fail(unsupportedError(method))
  return Object.freeze({
    getAppearance: () => Effect.succeed(new SystemAppearanceResult({ appearance: "light" })),
    getAccentColor: () => Effect.succeed(new SystemAppearanceAccentColorResult({ color: null })),
    getReducedMotion: () => Effect.succeed(new SystemAppearanceBooleanResult({ enabled: false })),
    getReducedTransparency: () =>
      Effect.succeed(new SystemAppearanceBooleanResult({ enabled: false })),
    onAppearanceChanged: () =>
      unsupportedStream<SystemAppearanceChangedEvent>("SystemAppearance.AppearanceChanged"),
    isSupported: () => Effect.succeed(new SystemAppearanceSupportedResult({ supported: false }))
  } satisfies SystemAppearanceClientApi)
}

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "host SystemAppearance platform adapter is not implemented yet",
    message: `unsupported SystemAppearance method: ${method}`,
    operation: method,
    recoverable: false
  })

function systemAppearanceMethodSpec<
  Input extends Schema.Schema<unknown>,
  Output extends Schema.Schema<unknown>
>(input: Input, output: Output, permission: string) {
  return { input, output, error: HostProtocolErrorSchema, permission } as const
}
