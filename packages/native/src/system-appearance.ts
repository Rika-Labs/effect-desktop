import {
  BridgeRpc,
  Client,
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeRpcHandlers,
  type BridgeRpcLayer,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  Rpc,
  RpcCapability,
  RpcGroup,
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

export const SystemAppearanceGetAppearance = systemAppearanceRpc(
  "getAppearance",
  Schema.Void,
  SystemAppearanceResult,
  "native.invoke:SystemAppearance.getAppearance"
)
export const SystemAppearanceGetAccentColor = systemAppearanceRpc(
  "getAccentColor",
  Schema.Void,
  SystemAppearanceAccentColorResult,
  "native.invoke:SystemAppearance.getAccentColor"
)
export const SystemAppearanceGetReducedMotion = systemAppearanceRpc(
  "getReducedMotion",
  Schema.Void,
  SystemAppearanceBooleanResult,
  "native.invoke:SystemAppearance.getReducedMotion"
)
export const SystemAppearanceGetReducedTransparency = systemAppearanceRpc(
  "getReducedTransparency",
  Schema.Void,
  SystemAppearanceBooleanResult,
  "native.invoke:SystemAppearance.getReducedTransparency"
)
export const SystemAppearanceIsSupported = systemAppearanceRpc(
  "isSupported",
  SystemAppearanceIsSupportedInput,
  SystemAppearanceSupportedResult,
  "none"
)

export const SystemAppearanceRpcEvents = Object.freeze({
  AppearanceChanged: { payload: SystemAppearanceChangedEvent }
})

export type SystemAppearanceRpcEvents = typeof SystemAppearanceRpcEvents

const SystemAppearanceRpcGroup = RpcGroup.make(
  SystemAppearanceGetAppearance,
  SystemAppearanceGetAccentColor,
  SystemAppearanceGetReducedMotion,
  SystemAppearanceGetReducedTransparency,
  SystemAppearanceIsSupported
)

export const SystemAppearanceRpcs = BridgeRpc.fromGroup(
  "SystemAppearance",
  SystemAppearanceRpcGroup,
  SystemAppearanceRpcEvents
)

export const SystemAppearanceMethodNames = Object.freeze([
  "getAppearance",
  "getAccentColor",
  "getReducedMotion",
  "getReducedTransparency",
  "isSupported"
] as const)

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

export type SystemAppearanceRpcSpec = (typeof SystemAppearanceRpcs)["spec"]

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
  const client = Client({ SystemAppearance: SystemAppearanceRpcs }, exchange, options)
    .SystemAppearance as unknown as {
    readonly getAppearance: () => Effect.Effect<
      SystemAppearanceResult,
      SystemAppearanceError,
      never
    >
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
    readonly isSupported: (
      input: SystemAppearanceIsSupportedInput
    ) => Effect.Effect<SystemAppearanceSupportedResult, SystemAppearanceError, never>
    readonly events: {
      readonly AppearanceChanged: Stream.Stream<
        SystemAppearanceChangedEvent,
        SystemAppearanceError,
        never
      >
    }
  }
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

function systemAppearanceRpc<
  Payload extends Schema.Schema<unknown>,
  Success extends Schema.Schema<unknown>
>(method: string, payload: Payload, success: Success, capability: string) {
  return Rpc.make(`SystemAppearance.${method}`, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}
