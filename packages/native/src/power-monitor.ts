import {
  Api,
  Client,
  type ApiClientExchange,
  type ApiClientOptions,
  type ApiContractClass,
  type ApiContractError,
  type ApiContractSpec,
  type ApiHandlers,
  type ApiLayer,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Option, Stream } from "effect"

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

export const PowerMonitorApiSpec = Object.freeze({
  isSupported: {
    input: PowerMonitorIsSupportedInput,
    output: PowerMonitorSupportedResult,
    error: HostProtocolErrorSchema,
    permission: "none"
  }
}) satisfies ApiContractSpec

export type PowerMonitorApiSpec = typeof PowerMonitorApiSpec

export const PowerMonitorApiEvents = Object.freeze({
  Suspend: { payload: PowerMonitorSuspendEvent },
  Resume: { payload: PowerMonitorResumeEvent },
  Shutdown: { payload: PowerMonitorShutdownEvent },
  PowerSourceChanged: { payload: PowerMonitorSourceChangedEvent }
})

export type PowerMonitorApiEvents = typeof PowerMonitorApiEvents

export const PowerMonitorApi: ApiContractClass<
  "PowerMonitor",
  PowerMonitorApiSpec,
  PowerMonitorApiEvents
> = (() => {
  const contract = class {
    static readonly tag = "PowerMonitor"
    static readonly spec = PowerMonitorApiSpec
    static readonly events = PowerMonitorApiEvents

    static layer<Handlers extends ApiHandlers<PowerMonitorApiSpec>>(
      handlers: Handlers
    ): ApiLayer<"PowerMonitor", PowerMonitorApiSpec, Handlers, PowerMonitorApiEvents> {
      return Object.freeze({ contract, handlers: Object.freeze(handlers) })
    }
  } as ApiContractClass<"PowerMonitor", PowerMonitorApiSpec, PowerMonitorApiEvents>

  return Object.freeze(contract)
})()

export const registerPowerMonitorApi = (): Effect.Effect<
  ApiContractClass<"PowerMonitor", PowerMonitorApiSpec, PowerMonitorApiEvents>,
  ApiContractError,
  never
> =>
  Effect.gen(function* () {
    const existing = yield* Api.get("PowerMonitor")
    if (Option.isSome(existing)) {
      return existing.value as ApiContractClass<
        "PowerMonitor",
        PowerMonitorApiSpec,
        PowerMonitorApiEvents
      >
    }
    return yield* Api.Tag("PowerMonitor")<unknown>()(PowerMonitorApiSpec, PowerMonitorApiEvents)
  })

export const PowerMonitorMethodNames = Object.freeze(
  Object.keys(PowerMonitorApiSpec) as ReadonlyArray<keyof PowerMonitorApiSpec>
)

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
  exchange: ApiClientExchange,
  options: ApiClientOptions = {}
): Layer.Layer<PowerMonitorClient> =>
  Layer.succeed(PowerMonitorClient)(makePowerMonitorBridgeClient(exchange, options))

export const makeHostPowerMonitorApiLayer = <Handlers extends ApiHandlers<PowerMonitorApiSpec>>(
  handlers: Handlers
): ApiLayer<"PowerMonitor", PowerMonitorApiSpec, Handlers, PowerMonitorApiEvents> =>
  PowerMonitorApi.layer(handlers)

const makePowerMonitorBridgeClient = (
  exchange: ApiClientExchange,
  options: ApiClientOptions
): PowerMonitorClientApi => {
  const client = Client({ PowerMonitor: PowerMonitorApi }, exchange, options).PowerMonitor
  return Object.freeze({
    onSuspend: () => client.events.Suspend,
    onResume: () => client.events.Resume,
    onShutdown: () => client.events.Shutdown,
    onPowerSourceChanged: () => client.events.PowerSourceChanged,
    isSupported: (method) => client.isSupported(new PowerMonitorIsSupportedInput({ method }))
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
