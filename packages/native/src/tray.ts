import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type RpcCapabilityMetadata,
  type RpcSupportMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import {
  type PermissionRegistry,
  P,
  type DesktopRpcClient,
  ResourceRegistry,
  type ResourceRegistryApi,
  ResourceRegistryLive
} from "@effect-desktop/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
import { subscribeNativeEvent } from "./event-stream.js"
import {
  TrayActivatedEvent,
  TrayCreateInput,
  type TrayCreateOptions,
  TrayDestroyInput,
  type TrayHandle,
  TrayResource,
  TraySetIconInput,
  TraySetMenuInput,
  TraySetTitleInput,
  TraySetTooltipInput,
  TraySupportedResult
} from "./contracts/tray.js"
import type { MenuTemplateOptions } from "./menu.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
const TrayTitleSupport = NativeSurface.support.partial("windows-tray-title-unavailable", {
  platforms: [
    { platform: "macos", status: "supported" },
    { platform: "windows", status: "unsupported", reason: "windows-tray-title-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-tray-unavailable" }
  ]
}) satisfies RpcSupportMetadata
const TrayTooltipSupport = NativeSurface.support.partial("linux-tray-tooltip-unavailable", {
  platforms: [
    { platform: "macos", status: "supported" },
    { platform: "windows", status: "supported" },
    { platform: "linux", status: "unsupported", reason: "linux-tray-tooltip-unavailable" }
  ]
}) satisfies RpcSupportMetadata
const TrayPlatformSupport = NativeSurface.support.partial("linux-tray-unavailable", {
  platforms: [
    { platform: "macos", status: "supported" },
    { platform: "windows", status: "supported" },
    { platform: "linux", status: "unsupported", reason: "host-tray-unavailable" }
  ]
}) satisfies RpcSupportMetadata

export type TrayError = HostProtocolError

export const TrayCreate = trayRpc(
  "create",
  TrayCreateInput,
  TrayResource,
  P.nativeInvoke({ primitive: "Tray", methods: ["create"] }),
  TrayPlatformSupport
)
export const TraySetIcon = trayRpc(
  "setIcon",
  TraySetIconInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Tray", methods: ["setIcon"] }),
  TrayPlatformSupport
)
export const TraySetTooltip = trayRpc(
  "setTooltip",
  TraySetTooltipInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Tray", methods: ["setTooltip"] }),
  TrayTooltipSupport
)
export const TraySetTitle = trayRpc(
  "setTitle",
  TraySetTitleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Tray", methods: ["setTitle"] }),
  TrayTitleSupport
)
export const TraySetMenu = trayRpc(
  "setMenu",
  TraySetMenuInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Tray", methods: ["setMenu"] }),
  TrayPlatformSupport
)
export const TrayDestroy = trayRpc(
  "destroy",
  TrayDestroyInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Tray", methods: ["destroy"] }),
  TrayPlatformSupport
)
export const TrayIsSupported = trayRpc("isSupported", Schema.Void, TraySupportedResult, {
  kind: "none"
})

export const TrayRpcEvents = Object.freeze({
  Activated: { payload: TrayActivatedEvent }
})

export type TrayRpcEvents = typeof TrayRpcEvents

const TrayRpcGroup = RpcGroup.make(
  TrayCreate,
  TraySetIcon,
  TraySetTooltip,
  TraySetTitle,
  TraySetMenu,
  TrayDestroy,
  TrayIsSupported
)

export const TrayRpcs: RpcGroup.RpcGroup<TrayRpc> = TrayRpcGroup

export const TrayMethodNames = Object.freeze([
  "create",
  "setIcon",
  "setTooltip",
  "setTitle",
  "setMenu",
  "destroy",
  "isSupported"
] as const)

const TrayCapabilityMethods = Object.freeze([
  "create",
  "setIcon",
  "setTooltip",
  "setTitle",
  "setMenu",
  "destroy"
] as const satisfies readonly (typeof TrayMethodNames)[number][])

export interface TrayClientApi {
  readonly create: (input: TrayCreateOptions) => Effect.Effect<TrayHandle, TrayError, never>
  readonly setIcon: (tray: TrayHandle, icon: string) => Effect.Effect<void, TrayError, never>
  readonly setTooltip: (tray: TrayHandle, tooltip: string) => Effect.Effect<void, TrayError, never>
  readonly setTitle: (tray: TrayHandle, title: string) => Effect.Effect<void, TrayError, never>
  readonly setMenu: (
    tray: TrayHandle,
    menu: MenuTemplateOptions
  ) => Effect.Effect<void, TrayError, never>
  readonly destroy: (tray: TrayHandle) => Effect.Effect<void, TrayError, never>
  readonly onActivated: () => Stream.Stream<TrayActivatedEvent, TrayError, never>
  readonly isSupported: () => Effect.Effect<TraySupportedResult, TrayError, never>
}

export class TrayClient extends Context.Service<TrayClient, TrayClientApi>()(
  "@effect-desktop/native/TrayClient"
) {}

export interface TrayServiceApi extends Omit<TrayClientApi, "isSupported"> {
  readonly isSupported: () => Effect.Effect<boolean, TrayError, never>
}

export interface TrayServiceOptions {
  readonly resources: ResourceRegistryApi
}

export class Tray extends Context.Service<Tray, TrayServiceApi>()("@effect-desktop/native/Tray") {
  static readonly layer = Layer.provide(
    Layer.effect(Tray)(
      Effect.gen(function* () {
        const client = yield* TrayClient
        const resources = yield* ResourceRegistry
        return makeTrayService(client, { resources })
      })
    ),
    ResourceRegistryLive
  )
}

const makeTrayService = (client: TrayClientApi, options: TrayServiceOptions): TrayServiceApi => {
  const explicitlyDestroyed = new Set<string>()
  return Tray.of({
    create: (input) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const created = yield* restore(client.create(input))
          const handle = yield* options.resources
            .register({
              kind: "tray",
              id: created.id,
              ownerScope: created.ownerScope,
              state: "open",
              reusableId: true,
              dispose: Effect.gen(function* () {
                if (explicitlyDestroyed.has(created.id)) {
                  return
                }
                yield* client.destroy(created)
              }).pipe(Effect.ignore)
            })
            .pipe(
              Effect.tapError(() => client.destroy(created).pipe(Effect.ignore)),
              Effect.mapError((error) =>
                makeHostProtocolInvalidArgumentError(error.field, error.message, "Tray.create")
              )
            )
          return toTrayHandle(handle)
        })
      ),
    setIcon: (tray, icon) => client.setIcon(tray, icon),
    setTooltip: (tray, tooltip) => client.setTooltip(tray, tooltip),
    setTitle: (tray, title) => client.setTitle(tray, title),
    setMenu: (tray, menu) => client.setMenu(tray, menu),
    destroy: (tray) =>
      Effect.gen(function* () {
        if (tray.kind !== "tray" || tray.state !== "open") {
          return yield* Effect.fail(
            makeHostProtocolInvalidArgumentError(
              "tray",
              "must be an open tray handle",
              "Tray.destroy"
            )
          )
        }
        yield* client.destroy(tray)
        explicitlyDestroyed.add(tray.id)
        yield* options.resources
          .dispose(tray.id)
          .pipe(Effect.ensuring(Effect.sync(() => explicitlyDestroyed.delete(tray.id))))
      }),
    onActivated: () => client.onActivated(),
    isSupported: () => client.isSupported().pipe(Effect.map((result) => result.supported))
  } satisfies TrayServiceApi)
}

export const TrayLive = Tray.layer

export const makeTrayClientLayer = (client: TrayClientApi): Layer.Layer<TrayClient> =>
  Layer.succeed(TrayClient)(client)

export const makeTrayServiceLayer = (
  client: TrayClientApi,
  options?: TrayServiceOptions
): Layer.Layer<Tray> =>
  options === undefined
    ? Layer.provide(TrayLive, makeTrayClientLayer(client))
    : Layer.succeed(Tray, makeTrayService(client, options))

export const makeTrayBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<TrayClient> => TraySurface.bridgeClientLayer(exchange, options)

export type TrayRpc = RpcGroup.Rpcs<typeof TrayRpcGroup>

export type TrayRpcHandlers = RpcGroup.HandlersFrom<TrayRpc>

export const TrayHandlersLive = TrayRpcGroup.toLayer({
  "Tray.create": (input) =>
    Effect.gen(function* () {
      const tray = yield* Tray
      return yield* tray.create(input)
    }),
  "Tray.setIcon": (input) =>
    Effect.gen(function* () {
      const tray = yield* Tray
      yield* tray.setIcon(input.tray, input.icon)
    }),
  "Tray.setTooltip": (input) =>
    Effect.gen(function* () {
      const tray = yield* Tray
      yield* tray.setTooltip(input.tray, input.tooltip)
    }),
  "Tray.setTitle": (input) =>
    Effect.gen(function* () {
      const tray = yield* Tray
      yield* tray.setTitle(input.tray, input.title)
    }),
  "Tray.setMenu": (input) =>
    Effect.gen(function* () {
      const tray = yield* Tray
      yield* tray.setMenu(input.tray, input.menu)
    }),
  "Tray.destroy": (input) =>
    Effect.gen(function* () {
      const tray = yield* Tray
      yield* tray.destroy(input.tray)
    }),
  "Tray.isSupported": () =>
    Effect.gen(function* () {
      const tray = yield* Tray
      const supported = yield* tray.isSupported()
      return new TraySupportedResult({ supported })
    })
})

export const TraySurface = NativeSurface.make("Tray", TrayRpcGroup, {
  service: TrayClient,
  capabilities: TrayCapabilityMethods,
  handlers: TrayHandlersLive,
  client: (client) => trayClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => trayClientFromRpcClient(client, exchange)
})

export const makeHostTrayRpcRuntime = (
  handlers: TrayRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry | ResourceRegistry> =>
  TraySurface.hostRuntime(handlers, runtimeOptions)

const trayClientFromRpcClient = (
  client: DesktopRpcClient<TrayRpc>,
  exchange: BridgeClientExchange | undefined
): TrayClientApi => {
  const trayClient: TrayClientApi = {
    create: (input) =>
      decodeTrayCreateInput(input).pipe(
        Effect.flatMap((decoded) => runTrayRpc(client["Tray.create"](decoded), "Tray.create"))
      ),
    setIcon: (tray, icon) =>
      decodeTraySetIconInput({ tray: toTrayHandle(tray), icon }).pipe(
        Effect.flatMap((decoded) => runTrayRpc(client["Tray.setIcon"](decoded), "Tray.setIcon"))
      ),
    setTooltip: (tray, tooltip) =>
      decodeTraySetTooltipInput({ tray: toTrayHandle(tray), tooltip }).pipe(
        Effect.flatMap((decoded) =>
          runTrayRpc(client["Tray.setTooltip"](decoded), "Tray.setTooltip")
        )
      ),
    setTitle: (tray, title) =>
      decodeTraySetTitleInput({ tray: toTrayHandle(tray), title }).pipe(
        Effect.flatMap((decoded) => runTrayRpc(client["Tray.setTitle"](decoded), "Tray.setTitle"))
      ),
    setMenu: (tray, menu) =>
      decodeTraySetMenuInput({ tray: toTrayHandle(tray), menu }).pipe(
        Effect.flatMap((decoded) => runTrayRpc(client["Tray.setMenu"](decoded), "Tray.setMenu"))
      ),
    destroy: (tray) =>
      decodeTrayDestroyInput({ tray: toTrayHandle(tray) }).pipe(
        Effect.flatMap((decoded) => runTrayRpc(client["Tray.destroy"](decoded), "Tray.destroy"))
      ),
    onActivated: () => subscribeTrayEvent(exchange, "Tray.Activated"),
    isSupported: () => runTrayRpc(client["Tray.isSupported"](undefined), "Tray.isSupported")
  }

  return Object.freeze(trayClient)
}

const subscribeTrayEvent = (
  exchange: BridgeClientExchange | undefined,
  method: "Tray.Activated"
): Stream.Stream<TrayActivatedEvent, TrayError, never> =>
  subscribeNativeEvent(exchange, method, TrayActivatedEvent)

const toTrayHandle = (handle: TrayHandle): TrayHandle =>
  Object.freeze({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  })

const decodeTrayCreateInput = (input: unknown): Effect.Effect<TrayCreateInput, TrayError, never> =>
  decodeInput(TrayCreateInput, input, "Tray.create")

const decodeTraySetIconInput = (
  input: unknown
): Effect.Effect<TraySetIconInput, TrayError, never> =>
  decodeInput(TraySetIconInput, input, "Tray.setIcon")

const decodeTraySetTooltipInput = (
  input: unknown
): Effect.Effect<TraySetTooltipInput, TrayError, never> =>
  decodeInput(TraySetTooltipInput, input, "Tray.setTooltip")

const decodeTraySetTitleInput = (
  input: unknown
): Effect.Effect<TraySetTitleInput, TrayError, never> =>
  decodeInput(TraySetTitleInput, input, "Tray.setTitle")

const decodeTraySetMenuInput = (
  input: unknown
): Effect.Effect<TraySetMenuInput, TrayError, never> =>
  decodeInput(TraySetMenuInput, input, "Tray.setMenu")

const decodeTrayDestroyInput = (
  input: unknown
): Effect.Effect<TrayDestroyInput, TrayError, never> =>
  decodeInput(TrayDestroyInput, input, "Tray.destroy").pipe(
    Effect.flatMap(validateDestroyTrayHandle)
  )

const validateDestroyTrayHandle = (
  input: TrayDestroyInput
): Effect.Effect<TrayDestroyInput, TrayError, never> =>
  input.tray.kind === "tray" && input.tray.state === "open"
    ? Effect.succeed(input)
    : Effect.fail(
        makeHostProtocolInvalidArgumentError("tray", "must be an open tray handle", "Tray.destroy")
      )

const decodeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, TrayError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

function trayRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(
  method: Method,
  payload: Payload,
  success: Success,
  capability: RpcCapabilityMetadata,
  support: RpcSupportMetadata = NativeSurface.support.supported
) {
  return NativeSurface.rpc("Tray", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support
  })
}

const runTrayRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, TrayError, never> =>
  effect.pipe(
    Effect.mapError(mapTrayRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapTrayRpcClientError = (error: unknown): TrayError =>
  isTrayError(error) ? error : makeHostProtocolInternalError("Tray RPC client failed", "Tray")

const isTrayError = (error: unknown): error is TrayError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
