import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolEventEnvelope,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeDesktopClientProtocol,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  Rpc,
  RpcClient,
  RpcCapability,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import type { PermissionRegistry } from "@effect-desktop/core"
import { P, DesktopRpc, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { makeNativeHostRpcRuntime } from "./native-rpc-runtime.js"
import {
  TrayActivatedEvent,
  TrayCreateInput,
  type TrayCreateOptions,
  TrayDestroyInput,
  type TrayHandle,
  TrayResource,
  TraySetIconInput,
  TraySetMenuInput,
  TraySetTooltipInput,
  TraySupportedResult
} from "./contracts/tray.js"
import type { MenuTemplateOptions } from "./menu.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

export type TrayError = HostProtocolError

export const TrayCreate = trayRpc(
  "create",
  TrayCreateInput,
  TrayResource,
  P.nativeInvoke({ primitive: "Tray", methods: ["create"] })
)
export const TraySetIcon = trayRpc(
  "setIcon",
  TraySetIconInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Tray", methods: ["setIcon"] })
)
export const TraySetTooltip = trayRpc(
  "setTooltip",
  TraySetTooltipInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Tray", methods: ["setTooltip"] })
)
export const TraySetMenu = trayRpc(
  "setMenu",
  TraySetMenuInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Tray", methods: ["setMenu"] })
)
export const TrayDestroy = trayRpc(
  "destroy",
  TrayDestroyInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Tray", methods: ["destroy"] })
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
  TraySetMenu,
  TrayDestroy,
  TrayIsSupported
)

export const TrayRpcs: RpcGroup.RpcGroup<TrayRpc> = TrayRpcGroup

export const TrayMethodNames = Object.freeze([
  "create",
  "setIcon",
  "setTooltip",
  "setMenu",
  "destroy",
  "isSupported"
] as const)

export interface TrayClientApi {
  readonly create: (input: TrayCreateOptions) => Effect.Effect<TrayHandle, TrayError, never>
  readonly setIcon: (tray: TrayHandle, icon: string) => Effect.Effect<void, TrayError, never>
  readonly setTooltip: (tray: TrayHandle, tooltip: string) => Effect.Effect<void, TrayError, never>
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

export class Tray extends Context.Service<Tray, TrayServiceApi>()("@effect-desktop/native/Tray") {}

export const TrayLive = Layer.effect(Tray)(
  Effect.gen(function* () {
    const client = yield* TrayClient
    return Object.freeze({
      create: (input) => client.create(input),
      setIcon: (tray, icon) => client.setIcon(tray, icon),
      setTooltip: (tray, tooltip) => client.setTooltip(tray, tooltip),
      setMenu: (tray, menu) => client.setMenu(tray, menu),
      destroy: (tray) => client.destroy(tray),
      onActivated: () => client.onActivated(),
      isSupported: () => client.isSupported().pipe(Effect.map((result) => result.supported))
    } satisfies TrayServiceApi)
  })
)

export const makeTrayClientLayer = (client: TrayClientApi): Layer.Layer<TrayClient> =>
  Layer.succeed(TrayClient)(client)

export const makeTrayServiceLayer = (client: TrayClientApi): Layer.Layer<Tray> =>
  Layer.provide(TrayLive, makeTrayClientLayer(client))

export const makeTrayBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<TrayClient> =>
  Layer.effect(
    TrayClient,
    RpcClient.make(TrayRpcGroup).pipe(
      Effect.map((client) => trayClientFromRpcClient(client, exchange))
    )
  ).pipe(Layer.provide(makeTrayBridgeProtocolLayer(exchange, options)))

export type TrayRpc = RpcGroup.Rpcs<typeof TrayRpcGroup>

export type TrayRpcHandlers = Parameters<typeof TrayRpcGroup.toLayer>[0]

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

export const TraySurface = DesktopRpc.surface("Tray", TrayRpcGroup, {
  service: TrayClient,
  handlers: TrayHandlersLive,
  client: (client) => trayClientFromRpcClient(client, undefined)
})

export const makeHostTrayRpcRuntime = (
  handlers: TrayRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  makeNativeHostRpcRuntime(TrayRpcGroup, TrayRpcGroup.toLayer(handlers), runtimeOptions)

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

const makeTrayBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const subscribeTrayEvent = (
  exchange: BridgeClientExchange | undefined,
  method: "Tray.Activated"
): Stream.Stream<TrayActivatedEvent, TrayError, never> => {
  if (exchange?.subscribe === undefined) {
    return Stream.fail(
      makeHostProtocolInvalidOutputError(method, "event exchange does not support subscriptions")
    )
  }

  return exchange
    .subscribe(method)
    .pipe(Stream.mapEffect((envelope) => decodeTrayEventEnvelope(method, envelope)))
}

const decodeTrayEventEnvelope = (
  operation: string,
  envelope: HostProtocolEventEnvelope
): Effect.Effect<TrayActivatedEvent, TrayError, never> => {
  if (envelope.method !== operation) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(operation, `unexpected event method: ${envelope.method}`)
    )
  }

  return Schema.decodeUnknownEffect(TrayActivatedEvent)(envelope.payload).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )
}

export const makeUnsupportedTrayClient = (): TrayClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, TrayError, never> =>
    Effect.fail(unsupportedError(method))
  const unsupportedStream = <A>(method: string): Stream.Stream<A, TrayError, never> =>
    Stream.fail(unsupportedError(method))

  const client: TrayClientApi = {
    create: () => unsupportedEffect<TrayHandle>("Tray.create"),
    setIcon: () => unsupportedEffect<void>("Tray.setIcon"),
    setTooltip: () => unsupportedEffect<void>("Tray.setTooltip"),
    setMenu: () => unsupportedEffect<void>("Tray.setMenu"),
    destroy: () => unsupportedEffect<void>("Tray.destroy"),
    onActivated: () => unsupportedStream<TrayActivatedEvent>("Tray.Activated"),
    isSupported: () => Effect.succeed(new TraySupportedResult({ supported: false }))
  }

  return Object.freeze(client)
}

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "host Tray platform adapter is not implemented yet",
    message: `unsupported Tray method: ${method}`,
    operation: method,
    recoverable: false
  })

const toTrayHandle = (handle: TrayHandle): TrayHandle =>
  Object.freeze({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  }) as TrayHandle

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
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return Rpc.make(`Tray.${method}` as const, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability(capability))
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
