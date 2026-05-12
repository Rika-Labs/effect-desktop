import {
  BridgeRpc,
  Client,
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeRpcHandlers,
  type BridgeRpcLayer,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  Rpc,
  RpcCapability,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Schema } from "effect"

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
  "native.invoke:Dock.setBadgeCount"
)
export const DockSetBadgeText = dockRpc(
  "setBadgeText",
  DockSetBadgeTextInput,
  Schema.Void,
  "native.invoke:Dock.setBadgeText"
)
export const DockSetProgress = dockRpc(
  "setProgress",
  DockSetProgressInput,
  Schema.Void,
  "native.invoke:Dock.setProgress"
)
export const DockSetMenu = dockRpc(
  "setMenu",
  DockSetMenuInput,
  Schema.Void,
  "native.invoke:Dock.setMenu"
)
export const DockSetJumpList = dockRpc(
  "setJumpList",
  DockSetJumpListInput,
  Schema.Void,
  "native.invoke:Dock.setJumpList"
)
export const DockRequestAttention = dockRpc(
  "requestAttention",
  DockRequestAttentionInput,
  Schema.Void,
  "native.invoke:Dock.requestAttention"
)
export const DockIsSupported = dockRpc(
  "isSupported",
  DockIsSupportedInput,
  DockSupportedResult,
  "none"
)

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

export const DockRpcs = BridgeRpc.fromGroup("Dock", DockRpcGroup, DockRpcEvents)

export const DockMethodNames = Object.freeze([
  "setBadgeCount",
  "setBadgeText",
  "setProgress",
  "setMenu",
  "setJumpList",
  "requestAttention",
  "isSupported"
] as const)

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
): Layer.Layer<DockClient> => Layer.succeed(DockClient)(makeDockBridgeClient(exchange, options))

export type DockRpcSpec = (typeof DockRpcs)["spec"]

export const makeHostDockBridgeRpcLayer = <Handlers extends BridgeRpcHandlers<DockRpcSpec>>(
  handlers: Handlers
): BridgeRpcLayer<"Dock", DockRpcSpec, Handlers, DockRpcEvents> =>
  BridgeRpc.layer(DockRpcs)(handlers)

const makeDockBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): DockClientApi => {
  const client = Client({ Dock: DockRpcs }, exchange, options).Dock as unknown as {
    readonly setBadgeCount: (input: DockSetBadgeCountInput) => Effect.Effect<void, DockError, never>
    readonly setBadgeText: (input: DockSetBadgeTextInput) => Effect.Effect<void, DockError, never>
    readonly setProgress: (input: DockSetProgressInput) => Effect.Effect<void, DockError, never>
    readonly setMenu: (input: DockSetMenuInput) => Effect.Effect<void, DockError, never>
    readonly setJumpList: (input: DockSetJumpListInput) => Effect.Effect<void, DockError, never>
    readonly requestAttention: (
      input: DockRequestAttentionInput
    ) => Effect.Effect<void, DockError, never>
    readonly isSupported: (
      input: DockIsSupportedInput
    ) => Effect.Effect<DockSupportedResult, DockError, never>
  }
  return Object.freeze({
    setBadgeCount: (count) =>
      decodeDockSetBadgeCountInput({ count }).pipe(Effect.flatMap(client.setBadgeCount)),
    setBadgeText: (text) =>
      decodeDockSetBadgeTextInput({ text }).pipe(Effect.flatMap(client.setBadgeText)),
    setProgress: (value, options) =>
      decodeDockSetProgressInput({
        value,
        ...(options?.state === undefined ? {} : { options })
      }).pipe(Effect.flatMap(client.setProgress)),
    setMenu: (menu) => decodeDockSetMenuInput({ menu }).pipe(Effect.flatMap(client.setMenu)),
    setJumpList: (items) =>
      decodeDockSetJumpListInput({ items }).pipe(Effect.flatMap(client.setJumpList)),
    requestAttention: (options) =>
      decodeDockRequestAttentionInput(options ?? {}).pipe(Effect.flatMap(client.requestAttention)),
    isSupported: (method) =>
      decodeDockIsSupportedInput({ method }).pipe(Effect.flatMap(client.isSupported))
  } satisfies DockClientApi)
}

export const makeUnsupportedDockClient = (): DockClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, DockError, never> =>
    Effect.fail(unsupportedError(method))
  return Object.freeze({
    setBadgeCount: () => unsupportedEffect<void>("Dock.setBadgeCount"),
    setBadgeText: () => unsupportedEffect<void>("Dock.setBadgeText"),
    setProgress: () => unsupportedEffect<void>("Dock.setProgress"),
    setMenu: () => unsupportedEffect<void>("Dock.setMenu"),
    setJumpList: () => unsupportedEffect<void>("Dock.setJumpList"),
    requestAttention: () => unsupportedEffect<void>("Dock.requestAttention"),
    isSupported: () => Effect.succeed(new DockSupportedResult({ supported: false }))
  } satisfies DockClientApi)
}

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

const unsupportedError = (
  method: string,
  reason = "host Dock platform adapter is not implemented yet"
): HostProtocolUnsupportedError =>
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
  decodeInput(DockSetBadgeCountInput, input, "Dock.setBadgeCount") as Effect.Effect<
    DockSetBadgeCountInput,
    DockError,
    never
  >

const decodeDockSetBadgeTextInput = (
  input: unknown
): Effect.Effect<DockSetBadgeTextInput, DockError, never> =>
  decodeInput(DockSetBadgeTextInput, input, "Dock.setBadgeText") as Effect.Effect<
    DockSetBadgeTextInput,
    DockError,
    never
  >

const decodeDockSetProgressInput = (
  input: unknown
): Effect.Effect<DockSetProgressInput, DockError, never> =>
  decodeInput(DockSetProgressInput, input, "Dock.setProgress") as Effect.Effect<
    DockSetProgressInput,
    DockError,
    never
  >

const decodeDockSetMenuInput = (
  input: unknown
): Effect.Effect<DockSetMenuInput, DockError, never> =>
  decodeInput(DockSetMenuInput, input, "Dock.setMenu") as Effect.Effect<
    DockSetMenuInput,
    DockError,
    never
  >

const decodeDockSetJumpListInput = (
  input: unknown
): Effect.Effect<DockSetJumpListInput, DockError, never> =>
  decodeInput(DockSetJumpListInput, input, "Dock.setJumpList") as Effect.Effect<
    DockSetJumpListInput,
    DockError,
    never
  >

const decodeDockRequestAttentionInput = (
  input: unknown
): Effect.Effect<DockRequestAttentionInput, DockError, never> =>
  decodeInput(DockRequestAttentionInput, input, "Dock.requestAttention") as Effect.Effect<
    DockRequestAttentionInput,
    DockError,
    never
  >

const decodeDockIsSupportedInput = (
  input: unknown
): Effect.Effect<DockIsSupportedInput, DockError, never> =>
  decodeInput(DockIsSupportedInput, input, "Dock.isSupported") as Effect.Effect<
    DockIsSupportedInput,
    DockError,
    never
  >

const decodeInput = (
  schema: Schema.Schema<unknown>,
  input: unknown,
  operation: string
): Effect.Effect<unknown, DockError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(schema)(input, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

function dockRpc<Payload extends Schema.Schema<unknown>, Success extends Schema.Schema<unknown>>(
  method: string,
  payload: Payload,
  success: Success,
  capability: string
) {
  return Rpc.make(`Dock.${method}`, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
