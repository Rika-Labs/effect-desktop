import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidOutputError,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { type PermissionRegistry, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
import { subscribeNativeEvent } from "./event-stream.js"
import {
  PowerMonitorIsSupportedInput,
  PowerMonitorLockScreenEvent,
  type PowerMonitorMethod,
  PowerMonitorResumeEvent,
  PowerMonitorShutdownEvent,
  PowerMonitorSourceChangedEvent,
  PowerMonitorSupportedResult,
  PowerMonitorSuspendEvent,
  PowerMonitorUnlockScreenEvent
} from "./contracts/power-monitor.js"

export type PowerMonitorError = HostProtocolError

const UnsupportedReason = "host-adapter-unimplemented"

const PowerMonitorSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export const PowerMonitorIsSupported = NativeSurface.rpc("PowerMonitor", "isSupported", {
  payload: PowerMonitorIsSupportedInput,
  success: PowerMonitorSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: PowerMonitorSupport
})

export const PowerMonitorRpcEvents = Object.freeze({
  Suspend: { payload: PowerMonitorSuspendEvent },
  Resume: { payload: PowerMonitorResumeEvent },
  Shutdown: { payload: PowerMonitorShutdownEvent },
  LockScreen: { payload: PowerMonitorLockScreenEvent },
  UnlockScreen: { payload: PowerMonitorUnlockScreenEvent },
  PowerSourceChanged: { payload: PowerMonitorSourceChangedEvent }
})

export type PowerMonitorRpcEvents = typeof PowerMonitorRpcEvents

const PowerMonitorRpcGroup = RpcGroup.make(PowerMonitorIsSupported)

export const PowerMonitorRpcs: RpcGroup.RpcGroup<PowerMonitorRpc> = PowerMonitorRpcGroup

export const PowerMonitorMethodNames = Object.freeze(["isSupported"] as const)

export interface PowerMonitorClientApi {
  readonly onSuspend: () => Stream.Stream<PowerMonitorSuspendEvent, PowerMonitorError, never>
  readonly onResume: () => Stream.Stream<PowerMonitorResumeEvent, PowerMonitorError, never>
  readonly onShutdown: () => Stream.Stream<PowerMonitorShutdownEvent, PowerMonitorError, never>
  readonly onLockScreen: () => Stream.Stream<PowerMonitorLockScreenEvent, PowerMonitorError, never>
  readonly onUnlockScreen: () => Stream.Stream<
    PowerMonitorUnlockScreenEvent,
    PowerMonitorError,
    never
  >
  readonly onPowerSourceChanged: () => Stream.Stream<
    PowerMonitorSourceChangedEvent,
    PowerMonitorError,
    never
  >
  readonly isSupported: (
    method: PowerMonitorMethod
  ) => Effect.Effect<PowerMonitorSupportedResult, PowerMonitorError, never>
}

export class PowerMonitorClient extends Context.Service<
  PowerMonitorClient,
  PowerMonitorClientApi
>()("@effect-desktop/native/PowerMonitorClient") {}

export interface PowerMonitorServiceApi extends Omit<PowerMonitorClientApi, "isSupported"> {
  readonly isSupported: (
    method: PowerMonitorMethod
  ) => Effect.Effect<boolean, PowerMonitorError, never>
}

export class PowerMonitor extends Context.Service<PowerMonitor, PowerMonitorServiceApi>()(
  "@effect-desktop/native/PowerMonitor"
) {
  static readonly layer = Layer.effect(PowerMonitor)(
    Effect.gen(function* () {
      const client = yield* PowerMonitorClient
      return PowerMonitor.of({
        onSuspend: () => client.onSuspend(),
        onResume: () => client.onResume(),
        onShutdown: () => client.onShutdown(),
        onLockScreen: () => client.onLockScreen(),
        onUnlockScreen: () => client.onUnlockScreen(),
        onPowerSourceChanged: () => client.onPowerSourceChanged(),
        isSupported: (method) =>
          client.isSupported(method).pipe(Effect.map((result) => result.supported))
      } satisfies PowerMonitorServiceApi)
    })
  )
}

export const PowerMonitorLive = PowerMonitor.layer

export const makePowerMonitorClientLayer = (
  client: PowerMonitorClientApi
): Layer.Layer<PowerMonitorClient> => Layer.succeed(PowerMonitorClient)(client)

export const makePowerMonitorServiceLayer = (
  client: PowerMonitorClientApi
): Layer.Layer<PowerMonitor> => Layer.provide(PowerMonitorLive, makePowerMonitorClientLayer(client))

export const makePowerMonitorBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<PowerMonitorClient> => PowerMonitorSurface.bridgeClientLayer(exchange, options)

export type PowerMonitorRpc = RpcGroup.Rpcs<typeof PowerMonitorRpcGroup>

export type PowerMonitorRpcHandlers = RpcGroup.HandlersFrom<PowerMonitorRpc>

export const PowerMonitorHandlersLive = PowerMonitorRpcGroup.toLayer({
  "PowerMonitor.isSupported": (input) =>
    Effect.gen(function* () {
      const monitor = yield* PowerMonitor
      const supported = yield* monitor.isSupported(input.method)
      return new PowerMonitorSupportedResult({ supported })
    })
})

export const PowerMonitorSurface = NativeSurface.make("PowerMonitor", PowerMonitorRpcGroup, {
  service: PowerMonitorClient,
  handlers: PowerMonitorHandlersLive,
  client: (client) => powerMonitorClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => powerMonitorClientFromRpcClient(client, exchange)
})

export const makeHostPowerMonitorRpcRuntime = (
  handlers: PowerMonitorRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  PowerMonitorSurface.hostRuntime(handlers, runtimeOptions)

const powerMonitorClientFromRpcClient = (
  client: DesktopRpcClient<PowerMonitorRpc>,
  exchange: BridgeClientExchange | undefined
): PowerMonitorClientApi =>
  Object.freeze({
    onSuspend: () =>
      supportedPowerMonitorEvent(
        client,
        exchange,
        "onSuspend",
        "PowerMonitor.Suspend",
        PowerMonitorSuspendEvent
      ),
    onResume: () =>
      supportedPowerMonitorEvent(
        client,
        exchange,
        "onResume",
        "PowerMonitor.Resume",
        PowerMonitorResumeEvent
      ),
    onShutdown: () =>
      supportedPowerMonitorEvent(
        client,
        exchange,
        "onShutdown",
        "PowerMonitor.Shutdown",
        PowerMonitorShutdownEvent
      ),
    onLockScreen: () =>
      supportedPowerMonitorEvent(
        client,
        exchange,
        "onLockScreen",
        "PowerMonitor.LockScreen",
        PowerMonitorLockScreenEvent
      ),
    onUnlockScreen: () =>
      supportedPowerMonitorEvent(
        client,
        exchange,
        "onUnlockScreen",
        "PowerMonitor.UnlockScreen",
        PowerMonitorUnlockScreenEvent
      ),
    onPowerSourceChanged: () =>
      supportedPowerMonitorEvent(
        client,
        exchange,
        "onPowerSourceChanged",
        "PowerMonitor.PowerSourceChanged",
        PowerMonitorSourceChangedEvent
      ),
    isSupported: (method) =>
      runPowerMonitorRpc(
        client["PowerMonitor.isSupported"](new PowerMonitorIsSupportedInput({ method })),
        "PowerMonitor.isSupported"
      )
  } satisfies PowerMonitorClientApi)

const supportedPowerMonitorEvent = <A>(
  client: DesktopRpcClient<PowerMonitorRpc>,
  exchange: BridgeClientExchange | undefined,
  method: PowerMonitorMethod,
  eventMethod: string,
  schema: Schema.Codec<A, unknown, never, never>
): Stream.Stream<A, PowerMonitorError, never> =>
  Stream.unwrap(
    runPowerMonitorRpc(
      client["PowerMonitor.isSupported"](new PowerMonitorIsSupportedInput({ method })),
      "PowerMonitor.isSupported"
    ).pipe(
      Effect.map((result) =>
        result.supported
          ? subscribePowerMonitorEvent(exchange, eventMethod, schema)
          : Stream.fail(unsupportedError(eventMethod))
      )
    )
  )

const subscribePowerMonitorEvent = <A>(
  exchange: BridgeClientExchange | undefined,
  method: string,
  schema: Schema.Codec<A, unknown, never, never>
): Stream.Stream<A, PowerMonitorError, never> => subscribeNativeEvent(exchange, method, schema)

const runPowerMonitorRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, PowerMonitorError, never> =>
  effect.pipe(
    Effect.mapError(mapPowerMonitorRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapPowerMonitorRpcClientError = (error: unknown): PowerMonitorError =>
  isPowerMonitorError(error)
    ? error
    : makeHostProtocolInternalError("PowerMonitor RPC client failed", "PowerMonitor")

const isPowerMonitorError = (error: unknown): error is PowerMonitorError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported PowerMonitor event source: ${operation}`,
    operation,
    recoverable: false
  })

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
