import { type BridgeClientExchange, type HostProtocolError, RpcGroup } from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import {
  AutostartEnableInput,
  type AutostartEnableOptions,
  AutostartEvent,
  AutostartStatus
} from "./contracts/autostart.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

export * from "./contracts/autostart.js"

const Surface = "Autostart"
const AutostartSupport = NativeSurface.support.supported

export type AutostartError = HostProtocolError

export const AutostartIsEnabled = NativeSurface.rpc(Surface, "isEnabled", {
  payload: Schema.Void,
  success: AutostartStatus,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["isEnabled"] })
  ),
  endpoint: "query",
  support: AutostartSupport
})
export const AutostartEnable = NativeSurface.rpc(Surface, "enable", {
  payload: AutostartEnableInput,
  success: AutostartStatus,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["enable"] })
  ),
  endpoint: "mutation",
  support: AutostartSupport
})
export const AutostartDisable = NativeSurface.rpc(Surface, "disable", {
  payload: Schema.Void,
  success: AutostartStatus,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["disable"] })
  ),
  endpoint: "mutation",
  support: AutostartSupport
})

export const AutostartRpcEvents = Object.freeze({
  Event: { payload: AutostartEvent }
})

const AutostartRpcGroup = RpcGroup.make(AutostartIsEnabled, AutostartEnable, AutostartDisable)

export const AutostartRpcs: RpcGroup.RpcGroup<AutostartRpc> = AutostartRpcGroup

export const AutostartMethodNames = Object.freeze(["isEnabled", "enable", "disable"] as const)

export interface AutostartClientApi {
  readonly isEnabled: () => Effect.Effect<AutostartStatus, AutostartError>
  readonly enable: (
    input?: AutostartEnableOptions
  ) => Effect.Effect<AutostartStatus, AutostartError>
  readonly disable: () => Effect.Effect<AutostartStatus, AutostartError>
  readonly events: () => Stream.Stream<AutostartEvent, AutostartError>
}

export class AutostartClient extends Context.Service<AutostartClient, AutostartClientApi>()(
  "@orika/native/AutostartClient"
) {}

export type AutostartServiceApi = AutostartClientApi

export class Autostart extends Context.Service<Autostart, AutostartServiceApi>()(
  "@orika/native/Autostart"
) {
  static readonly layer = Layer.effect(Autostart)(
    Effect.gen(function* () {
      const client = yield* AutostartClient
      return Autostart.of({
        isEnabled: () => client.isEnabled(),
        enable: (input) => client.enable(input),
        disable: () => client.disable(),
        events: () => client.events()
      } satisfies AutostartServiceApi)
    })
  )
}

export const AutostartLive = Autostart.layer

export type AutostartRpc = RpcGroup.Rpcs<typeof AutostartRpcGroup>
export type AutostartRpcHandlers<R = never> = NativeRpcHandlers<typeof AutostartRpcGroup, R>

export const AutostartHandlersLive = AutostartRpcGroup.toLayer({
  "Autostart.isEnabled": () =>
    Effect.gen(function* () {
      const autostart = yield* Autostart
      return yield* autostart.isEnabled()
    }),
  "Autostart.enable": (input) =>
    Effect.gen(function* () {
      const autostart = yield* Autostart
      return yield* autostart.enable(input)
    }),
  "Autostart.disable": () =>
    Effect.gen(function* () {
      const autostart = yield* Autostart
      return yield* autostart.disable()
    })
})

export const AutostartSurface = NativeSurface.make("Autostart", AutostartRpcGroup, {
  service: AutostartClient,
  capabilities: AutostartMethodNames,
  handlers: AutostartHandlersLive,
  client: (client) => autostartClientFromRpcClient(client),
  bridgeClient: (client, exchange) => autostartClientFromRpcClient(client, exchange)
})

const autostartClientFromRpcClient = (
  client: DesktopRpcClient<AutostartRpc>,
  exchange?: BridgeClientExchange
): AutostartClientApi =>
  Object.freeze({
    isEnabled: () => runAutostartRpc(client["Autostart.isEnabled"](), "Autostart.isEnabled"),
    enable: (input) =>
      decodeAutostartEnableInput(input ?? {}, "Autostart.enable").pipe(
        Effect.flatMap((decoded) =>
          runAutostartRpc(client["Autostart.enable"](decoded), "Autostart.enable")
        )
      ),
    disable: () => runAutostartRpc(client["Autostart.disable"](), "Autostart.disable"),
    events: () => subscribeNativeEvent(exchange, "Autostart.Event", AutostartEvent)
  } satisfies AutostartClientApi)

const decodeAutostartEnableInput = (
  input: unknown,
  operation: string
): Effect.Effect<AutostartEnableInput, AutostartError> =>
  decodeNativeInput(AutostartEnableInput, input, operation)

const runAutostartRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, AutostartError> => runNativeRpc(effect, operation, Surface)
