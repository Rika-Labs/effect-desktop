import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidOutputError,
  type RpcCapabilityMetadata,
  type RpcSupportMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { type PermissionRegistry, P, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
import { subscribeNativeEvent } from "./event-stream.js"
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

const UnsupportedReason = "host-adapter-unimplemented"
const HostSnapshotReason = "host-system-appearance-snapshot"
const StrictParseOptions = { onExcessProperty: "error" } as const

const SystemAppearanceUnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})
const SystemAppearanceSnapshotSupport = NativeSurface.support.partial(HostSnapshotReason, {
  platforms: [
    { platform: "macos", status: "supported" },
    { platform: "windows", status: "supported" },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
}) satisfies RpcSupportMetadata

export const SystemAppearanceGetAppearance = systemAppearanceRpc(
  "getAppearance",
  Schema.Void,
  SystemAppearanceResult,
  P.nativeInvoke({ primitive: "SystemAppearance", methods: ["getAppearance"] }),
  SystemAppearanceSnapshotSupport
)
export const SystemAppearanceGetAccentColor = systemAppearanceRpc(
  "getAccentColor",
  Schema.Void,
  SystemAppearanceAccentColorResult,
  P.nativeInvoke({ primitive: "SystemAppearance", methods: ["getAccentColor"] }),
  SystemAppearanceSnapshotSupport
)
export const SystemAppearanceGetReducedMotion = systemAppearanceRpc(
  "getReducedMotion",
  Schema.Void,
  SystemAppearanceBooleanResult,
  P.nativeInvoke({ primitive: "SystemAppearance", methods: ["getReducedMotion"] }),
  SystemAppearanceSnapshotSupport
)
export const SystemAppearanceGetReducedTransparency = systemAppearanceRpc(
  "getReducedTransparency",
  Schema.Void,
  SystemAppearanceBooleanResult,
  P.nativeInvoke({ primitive: "SystemAppearance", methods: ["getReducedTransparency"] }),
  SystemAppearanceSnapshotSupport
)
export const SystemAppearanceIsSupported = systemAppearanceRpc(
  "isSupported",
  SystemAppearanceIsSupportedInput,
  SystemAppearanceSupportedResult,
  { kind: "none" },
  NativeSurface.support.supported
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

const SystemAppearanceCapabilityMethods = Object.freeze([
  "getAppearance",
  "getAccentColor",
  "getReducedMotion",
  "getReducedTransparency"
] as const satisfies readonly (typeof SystemAppearanceMethodNames)[number][])

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
>()("@effect-desktop/native/SystemAppearance") {
  static readonly layer = Layer.effect(SystemAppearance)(
    Effect.gen(function* () {
      const client = yield* SystemAppearanceClient
      return SystemAppearance.of({
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
}

export const SystemAppearanceLive = SystemAppearance.layer

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
  SystemAppearanceSurface.bridgeClientLayer(exchange, options)

export type SystemAppearanceRpc = RpcGroup.Rpcs<typeof SystemAppearanceRpcGroup>

export type SystemAppearanceRpcHandlers = RpcGroup.HandlersFrom<SystemAppearanceRpc>

export const SystemAppearanceHandlersLive = SystemAppearanceRpcGroup.toLayer({
  "SystemAppearance.getAppearance": () =>
    Effect.gen(function* () {
      const appearance = yield* SystemAppearance
      const value = yield* appearance.getAppearance()
      return new SystemAppearanceResult({ appearance: value })
    }),
  "SystemAppearance.getAccentColor": () =>
    Effect.gen(function* () {
      const appearance = yield* SystemAppearance
      const color = yield* appearance.getAccentColor()
      return new SystemAppearanceAccentColorResult({ color })
    }),
  "SystemAppearance.getReducedMotion": () =>
    Effect.gen(function* () {
      const appearance = yield* SystemAppearance
      const enabled = yield* appearance.getReducedMotion()
      return new SystemAppearanceBooleanResult({ enabled })
    }),
  "SystemAppearance.getReducedTransparency": () =>
    Effect.gen(function* () {
      const appearance = yield* SystemAppearance
      const enabled = yield* appearance.getReducedTransparency()
      return new SystemAppearanceBooleanResult({ enabled })
    }),
  "SystemAppearance.isSupported": (input) =>
    Effect.gen(function* () {
      const appearance = yield* SystemAppearance
      const supported = yield* appearance.isSupported(input.method)
      return new SystemAppearanceSupportedResult({ supported })
    })
})

export const SystemAppearanceSurface = NativeSurface.make(
  "SystemAppearance",
  SystemAppearanceRpcGroup,
  {
    service: SystemAppearanceClient,
    capabilities: SystemAppearanceCapabilityMethods,
    handlers: SystemAppearanceHandlersLive,
    client: (client) =>
      systemAppearanceClientFromRpcClient(client, () =>
        Stream.fail(
          makeHostProtocolInvalidOutputError(
            "SystemAppearance.AppearanceChanged",
            "event exchange does not support subscriptions"
          )
        )
      ),
    bridgeClient: (client, exchange) =>
      systemAppearanceClientFromRpcClient(client, () =>
        subscribeSystemAppearanceEvent(exchange, "SystemAppearance.AppearanceChanged")
      )
  }
)

export const makeHostSystemAppearanceRpcRuntime = (
  handlers: SystemAppearanceRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  SystemAppearanceSurface.hostRuntime(handlers, runtimeOptions)

const systemAppearanceClientFromRpcClient = (
  client: DesktopRpcClient<SystemAppearanceRpc>,
  onAppearanceChanged: () => Stream.Stream<
    SystemAppearanceChangedEvent,
    SystemAppearanceError,
    never
  >
): SystemAppearanceClientApi =>
  Object.freeze({
    getAppearance: () =>
      runSystemAppearanceRpc(
        client["SystemAppearance.getAppearance"](undefined),
        "SystemAppearance.getAppearance"
      ),
    getAccentColor: () =>
      runSystemAppearanceRpc(
        client["SystemAppearance.getAccentColor"](undefined),
        "SystemAppearance.getAccentColor"
      ),
    getReducedMotion: () =>
      runSystemAppearanceRpc(
        client["SystemAppearance.getReducedMotion"](undefined),
        "SystemAppearance.getReducedMotion"
      ),
    getReducedTransparency: () =>
      runSystemAppearanceRpc(
        client["SystemAppearance.getReducedTransparency"](undefined),
        "SystemAppearance.getReducedTransparency"
      ),
    onAppearanceChanged,
    isSupported: (method) =>
      runSystemAppearanceRpc(
        client["SystemAppearance.isSupported"](new SystemAppearanceIsSupportedInput({ method })),
        "SystemAppearance.isSupported"
      )
  } satisfies SystemAppearanceClientApi)

const subscribeSystemAppearanceEvent = (
  exchange: BridgeClientExchange,
  method: "SystemAppearance.AppearanceChanged"
): Stream.Stream<SystemAppearanceChangedEvent, SystemAppearanceError, never> =>
  subscribeNativeEvent(exchange, method, SystemAppearanceChangedEvent, StrictParseOptions)

function systemAppearanceRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(
  method: Method,
  payload: Payload,
  success: Success,
  capability: RpcCapabilityMetadata,
  support: RpcSupportMetadata = SystemAppearanceUnsupportedSupport
) {
  return NativeSurface.rpc("SystemAppearance", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support
  })
}

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
