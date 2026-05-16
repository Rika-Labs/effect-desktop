import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolUnsupportedError,
  makeDesktopClientProtocol,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  RpcClient,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { type PermissionRegistry, P, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema } from "effect"

import { NativeSurface } from "./native-surface.js"
import {
  type DockMethod,
  DockIsSupportedInput,
  DockRequestAttentionInput,
  DockSetBadgeCountInput,
  DockSetBadgeTextInput,
  DockSetJumpListInput,
  DockSetMenuInput,
  DockSetProgressInput,
  DockSupportedResult
} from "./contracts/dock.js"
import type { MenuTemplateOptions } from "./menu.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

export type DockError = HostProtocolError

export const DockSetBadgeCount = dockRpc(
  "setBadgeCount",
  DockSetBadgeCountInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Dock", methods: ["setBadgeCount"] })
)
export const DockSetBadgeText = dockRpc(
  "setBadgeText",
  DockSetBadgeTextInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Dock", methods: ["setBadgeText"] })
)
export const DockSetProgress = dockRpc(
  "setProgress",
  DockSetProgressInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Dock", methods: ["setProgress"] })
)
export const DockSetMenu = dockRpc(
  "setMenu",
  DockSetMenuInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Dock", methods: ["setMenu"] })
)
export const DockSetJumpList = dockRpc(
  "setJumpList",
  DockSetJumpListInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Dock", methods: ["setJumpList"] })
)
export const DockRequestAttention = dockRpc(
  "requestAttention",
  DockRequestAttentionInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Dock", methods: ["requestAttention"] })
)
export const DockIsSupported = dockRpc("isSupported", DockIsSupportedInput, DockSupportedResult, {
  kind: "none"
})

export const DockRpcEvents = Object.freeze({})

export type DockRpcEvents = typeof DockRpcEvents

const DockRpcGroup = RpcGroup.make(
  DockSetBadgeCount,
  DockSetBadgeText,
  DockSetProgress,
  DockSetMenu,
  DockSetJumpList,
  DockRequestAttention,
  DockIsSupported
)

export const DockRpcs: RpcGroup.RpcGroup<DockRpc> = DockRpcGroup

export const DockMethodNames = Object.freeze([
  "setBadgeCount",
  "setBadgeText",
  "setProgress",
  "setMenu",
  "setJumpList",
  "requestAttention",
  "isSupported"
] as const)

const DockCapabilityMethods = Object.freeze([
  "setBadgeCount",
  "setBadgeText",
  "setProgress",
  "setMenu",
  "setJumpList",
  "requestAttention"
] as const satisfies readonly (typeof DockMethodNames)[number][])

export interface DockClientApi {
  readonly setBadgeCount: (count: number) => Effect.Effect<void, DockError, never>
  readonly setBadgeText: (text: string | null) => Effect.Effect<void, DockError, never>
  readonly setProgress: (
    value: number | null,
    options?: { readonly state?: "normal" | "indeterminate" | "error" | "paused" }
  ) => Effect.Effect<void, DockError, never>
  readonly setMenu: (menu: MenuTemplateOptions | null) => Effect.Effect<void, DockError, never>
  readonly setJumpList: (
    items: ReadonlyArray<{
      readonly id: string
      readonly title: string
      readonly commandId: string
    }>
  ) => Effect.Effect<void, DockError, never>
  readonly requestAttention: (options?: {
    readonly critical?: boolean
  }) => Effect.Effect<void, DockError, never>
  readonly isSupported: (method: DockMethod) => Effect.Effect<DockSupportedResult, DockError, never>
}

export class DockClient extends Context.Service<DockClient, DockClientApi>()(
  "@effect-desktop/native/DockClient"
) {}

export interface DockServiceApi extends Omit<DockClientApi, "isSupported"> {
  readonly isSupported: (method: DockMethod) => Effect.Effect<boolean, DockError, never>
}

export class Dock extends Context.Service<Dock, DockServiceApi>()("@effect-desktop/native/Dock") {}

export const DockLive = Layer.effect(Dock)(
  Effect.gen(function* () {
    const client = yield* DockClient
    return Object.freeze({
      setBadgeCount: (count) => client.setBadgeCount(count),
      setBadgeText: (text) => client.setBadgeText(text),
      setProgress: (value, options) => client.setProgress(value, options),
      setMenu: (menu) => client.setMenu(menu),
      setJumpList: (items) => client.setJumpList(items),
      requestAttention: (options) => client.requestAttention(options),
      isSupported: (method) =>
        client.isSupported(method).pipe(Effect.map((result) => result.supported))
    } satisfies DockServiceApi)
  })
)

export const makeDockClientLayer = (client: DockClientApi): Layer.Layer<DockClient> =>
  Layer.succeed(DockClient)(client)

export const makeDockServiceLayer = (client: DockClientApi): Layer.Layer<Dock> =>
  Layer.provide(DockLive, makeDockClientLayer(client))

export const makeDockBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<DockClient> =>
  Layer.provide(DockSurface.clientLayer, makeDockBridgeProtocolLayer(exchange, options))

export type DockRpc = RpcGroup.Rpcs<typeof DockRpcGroup>

export type DockRpcHandlers = RpcGroup.HandlersFrom<DockRpc>

export const DockHandlersLive = DockRpcGroup.toLayer({
  "Dock.setBadgeCount": (input) =>
    Effect.gen(function* () {
      const dock = yield* Dock
      yield* dock.setBadgeCount(input.count)
    }),
  "Dock.setBadgeText": (input) =>
    Effect.gen(function* () {
      const dock = yield* Dock
      yield* dock.setBadgeText(input.text)
    }),
  "Dock.setProgress": (input) =>
    Effect.gen(function* () {
      const dock = yield* Dock
      yield* dock.setProgress(input.value, input.options)
    }),
  "Dock.setMenu": (input) =>
    Effect.gen(function* () {
      const dock = yield* Dock
      yield* dock.setMenu(input.menu)
    }),
  "Dock.setJumpList": (input) =>
    Effect.gen(function* () {
      const dock = yield* Dock
      yield* dock.setJumpList(input.items)
    }),
  "Dock.requestAttention": (input) =>
    Effect.gen(function* () {
      const dock = yield* Dock
      yield* dock.requestAttention(input)
    }),
  "Dock.isSupported": (input) =>
    Effect.gen(function* () {
      const dock = yield* Dock
      const supported = yield* dock.isSupported(input.method)
      return new DockSupportedResult({ supported })
    })
})

export const DockSurface = NativeSurface.make("Dock", DockRpcGroup, {
  service: DockClient,
  capabilities: DockCapabilityMethods,
  handlers: DockHandlersLive,
  client: (client) => dockClientFromRpcClient(client)
})

export const makeHostDockRpcRuntime = (
  handlers: DockRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> => DockSurface.hostRuntime(handlers, runtimeOptions)

const dockClientFromRpcClient = (client: DesktopRpcClient<DockRpc>): DockClientApi => {
  return Object.freeze({
    setBadgeCount: (count) =>
      decodeDockSetBadgeCountInput({ count }).pipe(
        Effect.flatMap((decoded) =>
          runDockRpc(client["Dock.setBadgeCount"](decoded), "Dock.setBadgeCount")
        )
      ),
    setBadgeText: (text) =>
      decodeDockSetBadgeTextInput({ text }).pipe(
        Effect.flatMap((decoded) =>
          runDockRpc(client["Dock.setBadgeText"](decoded), "Dock.setBadgeText")
        )
      ),
    setProgress: (value, options) =>
      decodeDockSetProgressInput({
        value,
        ...(options?.state === undefined ? {} : { options })
      }).pipe(
        Effect.flatMap((decoded) =>
          runDockRpc(client["Dock.setProgress"](decoded), "Dock.setProgress")
        )
      ),
    setMenu: (menu) =>
      decodeDockSetMenuInput({ menu }).pipe(
        Effect.flatMap((decoded) => runDockRpc(client["Dock.setMenu"](decoded), "Dock.setMenu"))
      ),
    setJumpList: (items) =>
      decodeDockSetJumpListInput({ items }).pipe(
        Effect.flatMap((decoded) =>
          runDockRpc(client["Dock.setJumpList"](decoded), "Dock.setJumpList")
        )
      ),
    requestAttention: (options) =>
      decodeDockRequestAttentionInput(options ?? {}).pipe(
        Effect.flatMap((decoded) =>
          runDockRpc(client["Dock.requestAttention"](decoded), "Dock.requestAttention")
        )
      ),
    isSupported: (method) =>
      decodeDockIsSupportedInput({ method }).pipe(
        Effect.flatMap((decoded) =>
          runDockRpc(client["Dock.isSupported"](decoded), "Dock.isSupported")
        )
      )
  } satisfies DockClientApi)
}

const makeDockBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

export const makeLinuxDockClient = (): DockClientApi => {
  const unsupportedEffect = <A>(
    method: string,
    reason: string
  ): Effect.Effect<A, DockError, never> => Effect.fail(unsupportedError(method, reason))
  return Object.freeze({
    setBadgeCount: () =>
      unsupportedEffect<void>("Dock.setBadgeCount", "launcher badge API is not connected yet"),
    setBadgeText: () =>
      unsupportedEffect<void>("Dock.setBadgeText", "no portable badge text on Linux"),
    setProgress: () =>
      unsupportedEffect<void>("Dock.setProgress", "launcher progress API is not connected yet"),
    setMenu: () => unsupportedEffect<void>("Dock.setMenu", "no portable dock menu on Linux"),
    setJumpList: () => unsupportedEffect<void>("Dock.setJumpList", "jump lists are Windows-only"),
    requestAttention: () =>
      unsupportedEffect<void>(
        "Dock.requestAttention",
        "window-manager attention API is not connected yet"
      ),
    isSupported: () => Effect.succeed(new DockSupportedResult({ supported: false }))
  } satisfies DockClientApi)
}

const unsupportedError = (method: string, reason: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason,
    message: `unsupported Dock method: ${method}`,
    operation: method,
    recoverable: false
  })

const decodeDockSetBadgeCountInput = (
  input: unknown
): Effect.Effect<DockSetBadgeCountInput, DockError, never> =>
  decodeInput(DockSetBadgeCountInput, input, "Dock.setBadgeCount")

const decodeDockSetBadgeTextInput = (
  input: unknown
): Effect.Effect<DockSetBadgeTextInput, DockError, never> =>
  decodeInput(DockSetBadgeTextInput, input, "Dock.setBadgeText")

const decodeDockSetProgressInput = (
  input: unknown
): Effect.Effect<DockSetProgressInput, DockError, never> =>
  decodeInput(DockSetProgressInput, input, "Dock.setProgress")

const decodeDockSetMenuInput = (
  input: unknown
): Effect.Effect<DockSetMenuInput, DockError, never> =>
  decodeInput(DockSetMenuInput, input, "Dock.setMenu")

const decodeDockSetJumpListInput = (
  input: unknown
): Effect.Effect<DockSetJumpListInput, DockError, never> =>
  decodeInput(DockSetJumpListInput, input, "Dock.setJumpList")

const decodeDockRequestAttentionInput = (
  input: unknown
): Effect.Effect<DockRequestAttentionInput, DockError, never> =>
  decodeInput(DockRequestAttentionInput, input, "Dock.requestAttention")

const decodeDockIsSupportedInput = (
  input: unknown
): Effect.Effect<DockIsSupportedInput, DockError, never> =>
  decodeInput(DockIsSupportedInput, input, "Dock.isSupported")

const decodeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, DockError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

function dockRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc("Dock", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })
}

const runDockRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, DockError, never> =>
  effect.pipe(
    Effect.mapError(mapDockRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapDockRpcClientError = (error: unknown): DockError =>
  isDockError(error) ? error : makeHostProtocolInternalError("Dock RPC client failed", "Dock")

const isDockError = (error: unknown): error is DockError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
