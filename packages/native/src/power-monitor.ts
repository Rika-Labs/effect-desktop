import {
  type BridgeClientExchange,
  hostProtocolErrorFromRpcClientError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidOutputError,
  RpcGroup,
  type HostProtocolError
} from "@orika/bridge"
import { type DesktopRpcClient } from "@orika/core"
import { Context, Effect, Layer, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
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

const UnsupportedReason = "platform-power-monitor-unavailable"

const PowerMonitorSupport = NativeSurface.support.partial(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "supported" },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export const PowerMonitorIsSupported = NativeSurface.rpc("PowerMonitor", "isSupported", {
  payload: PowerMonitorIsSupportedInput,
  success: PowerMonitorSupportedResult,
  authority: NativeSurface.authority.native(),
  endpoint: "query",
  support: PowerMonitorSupport
})

const PowerMonitorSuspend = NativeSurface.event("PowerMonitor", "Suspend", {
  payload: PowerMonitorSuspendEvent,
  support: PowerMonitorSupport
})

const PowerMonitorResume = NativeSurface.event("PowerMonitor", "Resume", {
  payload: PowerMonitorResumeEvent,
  support: PowerMonitorSupport
})

const PowerMonitorShutdown = NativeSurface.event("PowerMonitor", "Shutdown", {
  payload: PowerMonitorShutdownEvent,
  support: PowerMonitorSupport
})

const PowerMonitorLockScreen = NativeSurface.event("PowerMonitor", "LockScreen", {
  payload: PowerMonitorLockScreenEvent,
  support: PowerMonitorSupport
})

const PowerMonitorUnlockScreen = NativeSurface.event("PowerMonitor", "UnlockScreen", {
  payload: PowerMonitorUnlockScreenEvent,
  support: PowerMonitorSupport
})

const PowerMonitorPowerSourceChanged = NativeSurface.event("PowerMonitor", "PowerSourceChanged", {
  payload: PowerMonitorSourceChangedEvent,
  support: PowerMonitorSupport
})

const PowerMonitorRpcGroup = RpcGroup.make(
  PowerMonitorIsSupported,
  PowerMonitorSuspend,
  PowerMonitorResume,
  PowerMonitorShutdown,
  PowerMonitorLockScreen,
  PowerMonitorUnlockScreen,
  PowerMonitorPowerSourceChanged
)

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
>()("@orika/native/PowerMonitorClient") {}

export interface PowerMonitorServiceApi extends Omit<PowerMonitorClientApi, "isSupported"> {
  readonly isSupported: (
    method: PowerMonitorMethod
  ) => Effect.Effect<boolean, PowerMonitorError, never>
}

export class PowerMonitor extends Context.Service<PowerMonitor, PowerMonitorServiceApi>()(
  "@orika/native/PowerMonitor"
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

export type PowerMonitorRpc = RpcGroup.Rpcs<typeof PowerMonitorRpcGroup>

export type PowerMonitorRpcHandlers<R = never> = NativeRpcHandlers<typeof PowerMonitorRpcGroup, R>

export const PowerMonitorHandlersLive = PowerMonitorRpcGroup.toLayer({
  "PowerMonitor.isSupported": (input) =>
    Effect.gen(function* () {
      const monitor = yield* PowerMonitor
      const supported = yield* monitor.isSupported(input.method)
      return new PowerMonitorSupportedResult({ supported })
    }),
  "PowerMonitor.events.Suspend": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const monitor = yield* PowerMonitor
        return monitor.onSuspend()
      })
    ),
  "PowerMonitor.events.Resume": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const monitor = yield* PowerMonitor
        return monitor.onResume()
      })
    ),
  "PowerMonitor.events.Shutdown": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const monitor = yield* PowerMonitor
        return monitor.onShutdown()
      })
    ),
  "PowerMonitor.events.LockScreen": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const monitor = yield* PowerMonitor
        return monitor.onLockScreen()
      })
    ),
  "PowerMonitor.events.UnlockScreen": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const monitor = yield* PowerMonitor
        return monitor.onUnlockScreen()
      })
    ),
  "PowerMonitor.events.PowerSourceChanged": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const monitor = yield* PowerMonitor
        return monitor.onPowerSourceChanged()
      })
    )
})

export const PowerMonitorSurface = NativeSurface.make("PowerMonitor", PowerMonitorRpcGroup, {
  service: PowerMonitorClient,
  capabilities: PowerMonitorMethodNames,
  handlers: PowerMonitorHandlersLive,
  client: (client) => powerMonitorClientFromRpcClient(client),
  bridgeClient: (client, exchange) => powerMonitorBridgeClientFromRpcClient(client, exchange)
})

const powerMonitorClientFromRpcClient = (
  client: DesktopRpcClient<PowerMonitorRpc>
): PowerMonitorClientApi =>
  Object.freeze({
    onSuspend: () =>
      runPowerMonitorRpcStream(
        client["PowerMonitor.events.Suspend"](undefined),
        "PowerMonitor.events.Suspend"
      ),
    onResume: () =>
      runPowerMonitorRpcStream(
        client["PowerMonitor.events.Resume"](undefined),
        "PowerMonitor.events.Resume"
      ),
    onShutdown: () =>
      runPowerMonitorRpcStream(
        client["PowerMonitor.events.Shutdown"](undefined),
        "PowerMonitor.events.Shutdown"
      ),
    onLockScreen: () =>
      runPowerMonitorRpcStream(
        client["PowerMonitor.events.LockScreen"](undefined),
        "PowerMonitor.events.LockScreen"
      ),
    onUnlockScreen: () =>
      runPowerMonitorRpcStream(
        client["PowerMonitor.events.UnlockScreen"](undefined),
        "PowerMonitor.events.UnlockScreen"
      ),
    onPowerSourceChanged: () =>
      runPowerMonitorRpcStream(
        client["PowerMonitor.events.PowerSourceChanged"](undefined),
        "PowerMonitor.events.PowerSourceChanged"
      ),
    isSupported: (method) =>
      runPowerMonitorRpc(
        client["PowerMonitor.isSupported"](new PowerMonitorIsSupportedInput({ method })),
        "PowerMonitor.isSupported"
      )
  } satisfies PowerMonitorClientApi)

const powerMonitorBridgeClientFromRpcClient = (
  client: DesktopRpcClient<PowerMonitorRpc>,
  exchange: BridgeClientExchange
): PowerMonitorClientApi =>
  Object.freeze({
    ...powerMonitorClientFromRpcClient(client),
    onSuspend: () =>
      supportedPowerMonitorEvent(client, "onSuspend", "PowerMonitor.Suspend", () =>
        NativeSurface.subscribeEvent(exchange, PowerMonitorSuspend)
      ),
    onResume: () =>
      supportedPowerMonitorEvent(client, "onResume", "PowerMonitor.Resume", () =>
        NativeSurface.subscribeEvent(exchange, PowerMonitorResume)
      ),
    onShutdown: () =>
      supportedPowerMonitorEvent(client, "onShutdown", "PowerMonitor.Shutdown", () =>
        NativeSurface.subscribeEvent(exchange, PowerMonitorShutdown)
      ),
    onLockScreen: () =>
      supportedPowerMonitorEvent(client, "onLockScreen", "PowerMonitor.LockScreen", () =>
        NativeSurface.subscribeEvent(exchange, PowerMonitorLockScreen)
      ),
    onUnlockScreen: () =>
      supportedPowerMonitorEvent(client, "onUnlockScreen", "PowerMonitor.UnlockScreen", () =>
        NativeSurface.subscribeEvent(exchange, PowerMonitorUnlockScreen)
      ),
    onPowerSourceChanged: () =>
      supportedPowerMonitorEvent(
        client,
        "onPowerSourceChanged",
        "PowerMonitor.PowerSourceChanged",
        () => NativeSurface.subscribeEvent(exchange, PowerMonitorPowerSourceChanged)
      )
  } satisfies PowerMonitorClientApi)

const supportedPowerMonitorEvent = <A>(
  client: DesktopRpcClient<PowerMonitorRpc>,
  method: PowerMonitorMethod,
  operation: string,
  event: () => Stream.Stream<A, PowerMonitorError, never>
): Stream.Stream<A, PowerMonitorError, never> =>
  Stream.unwrap(
    runPowerMonitorRpc(
      client["PowerMonitor.isSupported"](new PowerMonitorIsSupportedInput({ method })),
      "PowerMonitor.isSupported"
    ).pipe(
      Effect.map((result) =>
        result.supported ? event() : Stream.fail(unsupportedError(operation))
      )
    )
  )

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

const runPowerMonitorRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  _operation: string
): Stream.Stream<A, PowerMonitorError, never> =>
  stream.pipe(Stream.mapError(mapPowerMonitorRpcClientError))

const mapPowerMonitorRpcClientError = (error: unknown): PowerMonitorError =>
  isPowerMonitorError(error)
    ? error
    : (hostProtocolErrorFromRpcClientError(error) ??
      makeHostProtocolInternalError("PowerMonitor RPC client failed", "PowerMonitor"))

const isPowerMonitorError = (error: unknown): error is PowerMonitorError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const unsupportedError = (operation: string): PowerMonitorError => ({
  tag: "Unsupported",
  get _tag() {
    return this.tag
  },
  reason: UnsupportedReason,
  message: `unsupported PowerMonitor event source: ${operation}`,
  operation,
  recoverable: false
})

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
