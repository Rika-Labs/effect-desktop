import {
  type BridgeClientExchange,
  hostProtocolErrorFromRpcClientError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidOutputError,
  type RpcGroup,
  type HostProtocolError
} from "@orika/bridge"
import { type DesktopRpcClient } from "@orika/core"
import { Context, Effect, Layer, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
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
import {
  SystemAppearanceAppearanceChanged,
  SystemAppearanceCapabilityMethods,
  SystemAppearanceRpcs
} from "./system-appearance-rpc.js"

export {
  SystemAppearanceGetAccentColor,
  SystemAppearanceGetAppearance,
  SystemAppearanceGetReducedMotion,
  SystemAppearanceGetReducedTransparency,
  SystemAppearanceAppearanceChanged,
  SystemAppearanceIsSupported,
  SystemAppearanceMethodNames,
  SystemAppearanceRpcs,
  SystemAppearanceSnapshotSupport
} from "./system-appearance-rpc.js"

export type SystemAppearanceError = HostProtocolError

const UnsupportedReason = "host-adapter-unimplemented"
const StrictParseOptions = { onExcessProperty: "error" } as const

const SystemAppearanceRpcGroup = SystemAppearanceRpcs

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
>()("@orika/native/SystemAppearanceClient") {}

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
>()("@orika/native/SystemAppearance") {
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

export type SystemAppearanceRpc = RpcGroup.Rpcs<typeof SystemAppearanceRpcGroup>

export type SystemAppearanceRpcHandlers<R = never> = NativeRpcHandlers<
  typeof SystemAppearanceRpcGroup,
  R
>

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
    }),
  "SystemAppearance.events.AppearanceChanged": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const appearance = yield* SystemAppearance
        return appearance.onAppearanceChanged()
      })
    )
})

export const SystemAppearanceSurface = NativeSurface.make(
  "SystemAppearance",
  SystemAppearanceRpcGroup,
  {
    service: SystemAppearanceClient,
    capabilities: SystemAppearanceCapabilityMethods,
    handlers: SystemAppearanceHandlersLive,
    client: (client) => systemAppearanceClientFromRpcClient(client),
    bridgeClient: (client, exchange) => systemAppearanceBridgeClientFromRpcClient(client, exchange)
  }
)

const systemAppearanceClientFromRpcClient = (
  client: DesktopRpcClient<SystemAppearanceRpc>
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
    onAppearanceChanged: () =>
      runSystemAppearanceRpcStream(
        client["SystemAppearance.events.AppearanceChanged"](undefined),
        "SystemAppearance.events.AppearanceChanged"
      ),
    isSupported: (method) =>
      runSystemAppearanceRpc(
        client["SystemAppearance.isSupported"](new SystemAppearanceIsSupportedInput({ method })),
        "SystemAppearance.isSupported"
      )
  } satisfies SystemAppearanceClientApi)

const systemAppearanceBridgeClientFromRpcClient = (
  client: DesktopRpcClient<SystemAppearanceRpc>,
  exchange: BridgeClientExchange
): SystemAppearanceClientApi =>
  Object.freeze({
    ...systemAppearanceClientFromRpcClient(client),
    onAppearanceChanged: () => supportedAppearanceChangedEvent(client, exchange)
  } satisfies SystemAppearanceClientApi)

const supportedAppearanceChangedEvent = (
  client: DesktopRpcClient<SystemAppearanceRpc>,
  exchange: BridgeClientExchange
): Stream.Stream<SystemAppearanceChangedEvent, SystemAppearanceError, never> =>
  Stream.unwrap(
    runSystemAppearanceRpc(
      client["SystemAppearance.isSupported"](
        new SystemAppearanceIsSupportedInput({ method: "onAppearanceChanged" })
      ),
      "SystemAppearance.isSupported"
    ).pipe(
      Effect.map((result) =>
        result.supported
          ? NativeSurface.subscribeEvent(
              exchange,
              SystemAppearanceAppearanceChanged,
              StrictParseOptions
            )
          : Stream.fail(unsupportedError("SystemAppearance.AppearanceChanged"))
      )
    )
  )

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

const runSystemAppearanceRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  _operation: string
): Stream.Stream<A, SystemAppearanceError, never> =>
  stream.pipe(Stream.mapError(mapSystemAppearanceRpcClientError))

const mapSystemAppearanceRpcClientError = (error: unknown): SystemAppearanceError =>
  isSystemAppearanceError(error)
    ? error
    : (hostProtocolErrorFromRpcClientError(error) ??
      makeHostProtocolInternalError("SystemAppearance RPC client failed", "SystemAppearance"))

const isSystemAppearanceError = (error: unknown): error is SystemAppearanceError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const unsupportedError = (operation: string): SystemAppearanceError => ({
  tag: "Unsupported",
  get _tag() {
    return this.tag
  },
  reason: UnsupportedReason,
  message: `unsupported SystemAppearance event source: ${operation}`,
  operation,
  recoverable: false
})

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
