import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolEventEnvelope,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeDesktopClientProtocol,
  makeDesktopRpcHandlerRuntime,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidOutputError,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  Rpc,
  RpcClient,
  RpcCapability,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import type { DesktopRpcClient } from "@effect-desktop/core"
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

export const SystemAppearanceRpcs: RpcGroup.RpcGroup<SystemAppearanceRpc> = SystemAppearanceRpcGroup

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

export type SystemAppearanceRpc = RpcGroup.Rpcs<typeof SystemAppearanceRpcGroup>

export type SystemAppearanceRpcHandlers = Parameters<typeof SystemAppearanceRpcGroup.toLayer>[0]

export const makeHostSystemAppearanceRpcRuntime = (
  handlers: SystemAppearanceRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<unknown> =>
  makeDesktopRpcHandlerRuntime(
    SystemAppearanceRpcGroup,
    SystemAppearanceRpcGroup.toLayer(handlers),
    runtimeOptions
  )

const makeSystemAppearanceBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): SystemAppearanceClientApi => {
  return Object.freeze({
    getAppearance: () =>
      withSystemAppearanceRpcClient(exchange, options, (client) =>
        runSystemAppearanceRpc(
          client["SystemAppearance.getAppearance"](undefined),
          "SystemAppearance.getAppearance"
        )
      ),
    getAccentColor: () =>
      withSystemAppearanceRpcClient(exchange, options, (client) =>
        runSystemAppearanceRpc(
          client["SystemAppearance.getAccentColor"](undefined),
          "SystemAppearance.getAccentColor"
        )
      ),
    getReducedMotion: () =>
      withSystemAppearanceRpcClient(exchange, options, (client) =>
        runSystemAppearanceRpc(
          client["SystemAppearance.getReducedMotion"](undefined),
          "SystemAppearance.getReducedMotion"
        )
      ),
    getReducedTransparency: () =>
      withSystemAppearanceRpcClient(exchange, options, (client) =>
        runSystemAppearanceRpc(
          client["SystemAppearance.getReducedTransparency"](undefined),
          "SystemAppearance.getReducedTransparency"
        )
      ),
    onAppearanceChanged: () =>
      subscribeSystemAppearanceEvent(exchange, "SystemAppearance.AppearanceChanged"),
    isSupported: (method) =>
      withSystemAppearanceRpcClient(exchange, options, (client) =>
        runSystemAppearanceRpc(
          client["SystemAppearance.isSupported"](new SystemAppearanceIsSupportedInput({ method })),
          "SystemAppearance.isSupported"
        )
      )
  } satisfies SystemAppearanceClientApi)
}

const makeSystemAppearanceBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const withSystemAppearanceRpcClient = <A>(
  exchange: BridgeClientExchange,
  options: BridgeClientOptions,
  use: (client: SystemAppearanceRpcClient) => Effect.Effect<A, SystemAppearanceError, never>
): Effect.Effect<A, SystemAppearanceError, never> =>
  Effect.scoped(
    RpcClient.make(SystemAppearanceRpcGroup).pipe(
      Effect.flatMap(use),
      Effect.provide(makeSystemAppearanceBridgeProtocolLayer(exchange, options))
    )
  )

const subscribeSystemAppearanceEvent = (
  exchange: BridgeClientExchange,
  method: "SystemAppearance.AppearanceChanged"
): Stream.Stream<SystemAppearanceChangedEvent, SystemAppearanceError, never> => {
  if (exchange.subscribe === undefined) {
    return Stream.fail(
      makeHostProtocolInvalidOutputError(method, "event exchange does not support subscriptions")
    )
  }

  return exchange
    .subscribe(method)
    .pipe(Stream.mapEffect((envelope) => decodeSystemAppearanceEventEnvelope(method, envelope)))
}

const decodeSystemAppearanceEventEnvelope = (
  operation: string,
  envelope: HostProtocolEventEnvelope
): Effect.Effect<SystemAppearanceChangedEvent, SystemAppearanceError, never> => {
  if (envelope.method !== operation) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(operation, `unexpected event method: ${envelope.method}`)
    )
  }

  return Schema.decodeUnknownEffect(SystemAppearanceChangedEvent)(envelope.payload).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )
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
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: string) {
  return Rpc.make(`SystemAppearance.${method}` as const, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}

type SystemAppearanceRpcClient = DesktopRpcClient<SystemAppearanceRpc>

const runSystemAppearanceRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, SystemAppearanceError, never> =>
  effect.pipe(
    Effect.mapError(mapSystemAppearanceRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapSystemAppearanceRpcClientError = (error: unknown): SystemAppearanceError =>
  isSystemAppearanceError(error)
    ? error
    : makeHostProtocolInternalError("SystemAppearance RPC client failed", "SystemAppearance")

const isSystemAppearanceError = (error: unknown): error is SystemAppearanceError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
