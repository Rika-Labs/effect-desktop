import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolEventEnvelope,
  makeDesktopClientProtocol,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidOutputError,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  RpcClient,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { type PermissionRegistry, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
import {
  PowerMonitorIsSupportedInput,
  type PowerMonitorMethod,
  PowerMonitorResumeEvent,
  PowerMonitorShutdownEvent,
  PowerMonitorSourceChangedEvent,
  PowerMonitorSupportedResult,
  PowerMonitorSuspendEvent
} from "./contracts/power-monitor.js"

export type PowerMonitorError = HostProtocolError

export const PowerMonitorIsSupported = NativeSurface.rpc("PowerMonitor", "isSupported", {
  payload: PowerMonitorIsSupportedInput,
  success: PowerMonitorSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "mutation",
  support: NativeSurface.support.supported
})

export const PowerMonitorRpcEvents = Object.freeze({
  Suspend: { payload: PowerMonitorSuspendEvent },
  Resume: { payload: PowerMonitorResumeEvent },
  Shutdown: { payload: PowerMonitorShutdownEvent },
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
) {}

export const PowerMonitorLive = Layer.effect(PowerMonitor)(
  Effect.gen(function* () {
    const client = yield* PowerMonitorClient
    return Object.freeze({
      onSuspend: () => client.onSuspend(),
      onResume: () => client.onResume(),
      onShutdown: () => client.onShutdown(),
      onPowerSourceChanged: () => client.onPowerSourceChanged(),
      isSupported: (method) =>
        client.isSupported(method).pipe(Effect.map((result) => result.supported))
    } satisfies PowerMonitorServiceApi)
  })
)

export const makePowerMonitorClientLayer = (
  client: PowerMonitorClientApi
): Layer.Layer<PowerMonitorClient> => Layer.succeed(PowerMonitorClient)(client)

export const makePowerMonitorServiceLayer = (
  client: PowerMonitorClientApi
): Layer.Layer<PowerMonitor> => Layer.provide(PowerMonitorLive, makePowerMonitorClientLayer(client))

export const makePowerMonitorBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<PowerMonitorClient> =>
  Layer.effect(
    PowerMonitorClient,
    RpcClient.make(PowerMonitorRpcGroup).pipe(
      Effect.map((client) => powerMonitorClientFromRpcClient(client, exchange))
    )
  ).pipe(Layer.provide(makePowerMonitorBridgeProtocolLayer(exchange, options)))

export type PowerMonitorRpc = RpcGroup.Rpcs<typeof PowerMonitorRpcGroup>

export type PowerMonitorRpcHandlers = Parameters<typeof PowerMonitorRpcGroup.toLayer>[0]

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
  client: (client) => powerMonitorClientFromRpcClient(client, undefined)
})

export const makeHostPowerMonitorRpcRuntime = (
  handlers: PowerMonitorRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  PowerMonitorSurface.hostRuntime(handlers, runtimeOptions)

const powerMonitorClientFromRpcClient = (
  client: DesktopRpcClient<PowerMonitorRpc>,
  exchange: BridgeClientExchange | undefined
): PowerMonitorClientApi => {
  return Object.freeze({
    onSuspend: () =>
      subscribePowerMonitorEvent(exchange, "PowerMonitor.Suspend", PowerMonitorSuspendEvent),
    onResume: () =>
      subscribePowerMonitorEvent(exchange, "PowerMonitor.Resume", PowerMonitorResumeEvent),
    onShutdown: () =>
      subscribePowerMonitorEvent(exchange, "PowerMonitor.Shutdown", PowerMonitorShutdownEvent),
    onPowerSourceChanged: () =>
      subscribePowerMonitorEvent(
        exchange,
        "PowerMonitor.PowerSourceChanged",
        PowerMonitorSourceChangedEvent
      ),
    isSupported: (method) =>
      runPowerMonitorRpc(
        client["PowerMonitor.isSupported"](new PowerMonitorIsSupportedInput({ method })),
        "PowerMonitor.isSupported"
      )
  } satisfies PowerMonitorClientApi)
}

const makePowerMonitorBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const subscribePowerMonitorEvent = <A>(
  exchange: BridgeClientExchange | undefined,
  method: string,
  schema: Schema.Codec<A, unknown, never, never>
): Stream.Stream<A, PowerMonitorError, never> => {
  if (exchange?.subscribe === undefined) {
    return Stream.fail(
      makeHostProtocolInvalidOutputError(method, "event exchange does not support subscriptions")
    )
  }

  return exchange
    .subscribe(method)
    .pipe(Stream.mapEffect((envelope) => decodePowerMonitorEventEnvelope(method, schema, envelope)))
}

const decodePowerMonitorEventEnvelope = <A>(
  operation: string,
  schema: Schema.Codec<A, unknown, never, never>,
  envelope: HostProtocolEventEnvelope
): Effect.Effect<A, PowerMonitorError, never> => {
  if (envelope.method !== operation) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(operation, `unexpected event method: ${envelope.method}`)
    )
  }

  return Schema.decodeUnknownEffect(schema)(envelope.payload).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )
}

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

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
