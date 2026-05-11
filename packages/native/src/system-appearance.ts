import {
  BridgeRpc,
  Client,
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeRpcGroup,
  type BridgeRpcSpec,
  type BridgeRpcHandlers,
  type BridgeRpcLayer,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Schema, Stream } from "effect"

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

export const SystemAppearanceRpcSpec = Object.freeze({
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
}) satisfies BridgeRpcSpec

export type SystemAppearanceRpcSpec = typeof SystemAppearanceRpcSpec

export const SystemAppearanceRpcEvents = Object.freeze({
  AppearanceChanged: { payload: SystemAppearanceChangedEvent }
})

export type SystemAppearanceRpcEvents = typeof SystemAppearanceRpcEvents

export const SystemAppearanceRpcs: BridgeRpcGroup<
  "SystemAppearance",
  SystemAppearanceRpcSpec,
  SystemAppearanceRpcEvents
> = BridgeRpc.group("SystemAppearance", SystemAppearanceRpcSpec, SystemAppearanceRpcEvents)

export const SystemAppearanceMethodNames = Object.freeze(
  Object.keys(SystemAppearanceRpcSpec) as ReadonlyArray<keyof SystemAppearanceRpcSpec>
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
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<SystemAppearanceClient> =>
  Layer.succeed(SystemAppearanceClient)(makeSystemAppearanceBridgeClient(exchange, options))

export const makeHostSystemAppearanceBridgeRpcLayer = <
  Handlers extends BridgeRpcHandlers<SystemAppearanceRpcSpec>
>(
  handlers: Handlers
): BridgeRpcLayer<
  "SystemAppearance",
  SystemAppearanceRpcSpec,
  Handlers,
  SystemAppearanceRpcEvents
> => BridgeRpc.layer(SystemAppearanceRpcs)(handlers)

const makeSystemAppearanceBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): SystemAppearanceClientApi => {
  const client = Client(
    { SystemAppearance: SystemAppearanceRpcs },
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
    getAppearance: () => Effect.fail(unsupportedError("SystemAppearance.getAppearance")),
    getAccentColor: () => Effect.fail(unsupportedError("SystemAppearance.getAccentColor")),
    getReducedMotion: () => Effect.fail(unsupportedError("SystemAppearance.getReducedMotion")),
    getReducedTransparency: () =>
      Effect.fail(unsupportedError("SystemAppearance.getReducedTransparency")),
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
