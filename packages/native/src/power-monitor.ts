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
import { Context, Effect, Layer, Stream } from "effect"

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

export const PowerMonitorRpcs = BridgeRpc.fromGroup(
  "PowerMonitor",
  PowerMonitorRpcGroup,
  PowerMonitorRpcEvents
)

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

export type PowerMonitorRpcSpec = (typeof PowerMonitorRpcs)["spec"]

export const makeHostPowerMonitorBridgeRpcLayer = <
  Handlers extends BridgeRpcHandlers<PowerMonitorRpcSpec>
>(
  handlers: Handlers
): BridgeRpcLayer<"PowerMonitor", PowerMonitorRpcSpec, Handlers, PowerMonitorRpcEvents> =>
  BridgeRpc.layer(PowerMonitorRpcs)(handlers)

const makePowerMonitorBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): PowerMonitorClientApi => {
  const client = Client({ PowerMonitor: PowerMonitorRpcs }, exchange, options).PowerMonitor
  const methodClient = client as unknown as {
    readonly isSupported: (
      input: PowerMonitorIsSupportedInput
    ) => Effect.Effect<PowerMonitorSupportedResult, PowerMonitorError, never>
  }
  return Object.freeze({
    onSuspend: () => client.events.Suspend,
    onResume: () => client.events.Resume,
    onShutdown: () => client.events.Shutdown,
    onPowerSourceChanged: () => client.events.PowerSourceChanged,
    isSupported: (method) => methodClient.isSupported(new PowerMonitorIsSupportedInput({ method }))
  } satisfies PowerMonitorClientApi)
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
