import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  type RpcCapabilityMetadata,
  type RpcEndpointKind,
  RpcGroup
} from "@effect-desktop/bridge"
import { type DesktopRpcClient, type PermissionRegistry, P } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import {
  AutostartEnableInput,
  type AutostartEnableOptions,
  AutostartEvent,
  AutostartStatus
} from "./contracts/autostart.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/autostart.js"

const Surface = "Autostart"
const UnsupportedReason = "host-adapter-unimplemented"
const AutostartSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type AutostartError = HostProtocolError

export const AutostartIsEnabled = autostartRpc(
  "isEnabled",
  Schema.Void,
  AutostartStatus,
  P.nativeInvoke({ primitive: Surface, methods: ["isEnabled"] }),
  "query"
)
export const AutostartEnable = autostartRpc(
  "enable",
  AutostartEnableInput,
  AutostartStatus,
  P.nativeInvoke({ primitive: Surface, methods: ["enable"] }),
  "mutation"
)
export const AutostartDisable = autostartRpc(
  "disable",
  Schema.Void,
  AutostartStatus,
  P.nativeInvoke({ primitive: Surface, methods: ["disable"] }),
  "mutation"
)

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
  "@effect-desktop/native/AutostartClient"
) {}

export type AutostartServiceApi = AutostartClientApi

export class Autostart extends Context.Service<Autostart, AutostartServiceApi>()(
  "@effect-desktop/native/Autostart"
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

export const makeAutostartClientLayer = (
  client: AutostartClientApi
): Layer.Layer<AutostartClient> => Layer.succeed(AutostartClient)(client)

export const makeAutostartServiceLayer = (client: AutostartClientApi): Layer.Layer<Autostart> =>
  Layer.provide(AutostartLive, makeAutostartClientLayer(client))

export const makeAutostartBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<AutostartClient> => AutostartSurface.bridgeClientLayer(exchange, options)

export type AutostartRpc = RpcGroup.Rpcs<typeof AutostartRpcGroup>
export type AutostartRpcHandlers = RpcGroup.HandlersFrom<AutostartRpc>

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

export const makeHostAutostartRpcRuntime = (
  handlers: AutostartRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  AutostartSurface.hostRuntime(handlers, runtimeOptions)

const autostartClientFromRpcClient = (
  client: DesktopRpcClient<AutostartRpc>,
  _exchange?: BridgeClientExchange
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
    events: () => unsupportedAutostartEvents()
  } satisfies AutostartClientApi)

const decodeAutostartEnableInput = (
  input: unknown,
  operation: string
): Effect.Effect<AutostartEnableInput, AutostartError> =>
  decodeNativeInput(AutostartEnableInput, input, operation)

const unsupportedAutostartEvents = (): Stream.Stream<AutostartEvent, AutostartError> =>
  Stream.fail(unsupportedAutostartEventError())

const unsupportedAutostartEventError = (): AutostartError => ({
  tag: "Unsupported",
  get _tag() {
    return this.tag
  },
  reason: UnsupportedReason,
  message: "unsupported Autostart.Event",
  operation: "Autostart.Event",
  recoverable: false
})

function autostartRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(
  method: Method,
  payload: Payload,
  success: Success,
  authority: RpcCapabilityMetadata,
  endpoint: RpcEndpointKind
) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(authority),
    endpoint,
    support: AutostartSupport
  })
}

const runAutostartRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, AutostartError> => runNativeRpc(effect, operation, Surface)
