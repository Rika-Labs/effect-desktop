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
  PowerMonitorIsSupportedInput,
  type PowerMonitorMethod,
  PowerMonitorResumeEvent,
  PowerMonitorShutdownEvent,
  PowerMonitorSourceChangedEvent,
  PowerMonitorSupportedResult,
  PowerMonitorSuspendEvent
} from "./contracts/power-monitor.js"

export type PowerMonitorError = HostProtocolError

export const PowerMonitorIsSupported = Rpc.make("PowerMonitor.isSupported", {
  payload: PowerMonitorIsSupportedInput,
  success: PowerMonitorSupportedResult,
  error: HostProtocolErrorSchema
}).pipe(RpcCapability({ kind: "none" }))

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
  Layer.succeed(PowerMonitorClient)(makePowerMonitorBridgeClient(exchange, options))

export type PowerMonitorRpc = RpcGroup.Rpcs<typeof PowerMonitorRpcGroup>

export type PowerMonitorRpcHandlers = Parameters<typeof PowerMonitorRpcGroup.toLayer>[0]

export const makeHostPowerMonitorRpcRuntime = (
  handlers: PowerMonitorRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<unknown> =>
  makeDesktopRpcHandlerRuntime(
    PowerMonitorRpcGroup,
    PowerMonitorRpcGroup.toLayer(handlers),
    runtimeOptions
  )

const makePowerMonitorBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
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
      withPowerMonitorRpcClient(exchange, options, (client) =>
        runPowerMonitorRpc(
          client["PowerMonitor.isSupported"](new PowerMonitorIsSupportedInput({ method })),
          "PowerMonitor.isSupported"
        )
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

const withPowerMonitorRpcClient = <A>(
  exchange: BridgeClientExchange,
  options: BridgeClientOptions,
  use: (client: PowerMonitorRpcClient) => Effect.Effect<A, PowerMonitorError, never>
): Effect.Effect<A, PowerMonitorError, never> =>
  Effect.scoped(
    RpcClient.make(PowerMonitorRpcGroup).pipe(
      Effect.flatMap(use),
      Effect.provide(makePowerMonitorBridgeProtocolLayer(exchange, options))
    )
  )

const subscribePowerMonitorEvent = <A>(
  exchange: BridgeClientExchange,
  method: string,
  schema: Schema.Schema<A>
): Stream.Stream<A, PowerMonitorError, never> => {
  if (exchange.subscribe === undefined) {
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
  schema: Schema.Schema<A>,
  envelope: HostProtocolEventEnvelope
): Effect.Effect<A, PowerMonitorError, never> => {
  if (envelope.method !== operation) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(operation, `unexpected event method: ${envelope.method}`)
    )
  }

  return Effect.mapError(
    Schema.decodeUnknownEffect(schema)(envelope.payload) as Effect.Effect<A, unknown, never>,
    (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  )
}

export const makeUnsupportedPowerMonitorClient = (): PowerMonitorClientApi => {
  const unsupportedStream = <A>(method: string): Stream.Stream<A, PowerMonitorError, never> =>
    Stream.fail(unsupportedError(method))
  return Object.freeze({
    onSuspend: () => unsupportedStream<PowerMonitorSuspendEvent>("PowerMonitor.Suspend"),
    onResume: () => unsupportedStream<PowerMonitorResumeEvent>("PowerMonitor.Resume"),
    onShutdown: () => unsupportedStream<PowerMonitorShutdownEvent>("PowerMonitor.Shutdown"),
    onPowerSourceChanged: () =>
      unsupportedStream<PowerMonitorSourceChangedEvent>("PowerMonitor.PowerSourceChanged"),
    isSupported: () => Effect.succeed(new PowerMonitorSupportedResult({ supported: false }))
  } satisfies PowerMonitorClientApi)
}

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "host PowerMonitor platform adapter is not implemented yet",
    message: `unsupported PowerMonitor method: ${method}`,
    operation: method,
    recoverable: false
  })

type PowerMonitorRpcClient = DesktopRpcClient<PowerMonitorRpc>

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
