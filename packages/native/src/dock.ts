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
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Option, Schema } from "effect"

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

export const DockApiSpec = Object.freeze({
  setBadgeCount: dockMethodSpec(DockSetBadgeCountInput, "native.invoke:Dock.setBadgeCount"),
  setBadgeText: dockMethodSpec(DockSetBadgeTextInput, "native.invoke:Dock.setBadgeText"),
  setProgress: dockMethodSpec(DockSetProgressInput, "native.invoke:Dock.setProgress"),
  setMenu: dockMethodSpec(DockSetMenuInput, "native.invoke:Dock.setMenu"),
  setJumpList: dockMethodSpec(DockSetJumpListInput, "native.invoke:Dock.setJumpList"),
  requestAttention: dockMethodSpec(
    DockRequestAttentionInput,
    "native.invoke:Dock.requestAttention"
  ),
  isSupported: {
    input: DockIsSupportedInput,
    output: DockSupportedResult,
    error: HostProtocolErrorSchema,
    permission: "none"
  }
}) satisfies ApiContractSpec

export type DockApiSpec = typeof DockApiSpec

export const DockApiEvents = Object.freeze({})

export type DockApiEvents = typeof DockApiEvents

export const DockApi: ApiContractClass<"Dock", DockApiSpec, DockApiEvents> = (() => {
  const contract = class {
    static readonly tag = "Dock"
    static readonly spec = DockApiSpec
    static readonly events = DockApiEvents

    static layer<Handlers extends ApiHandlers<DockApiSpec>>(
      handlers: Handlers
    ): ApiLayer<"Dock", DockApiSpec, Handlers, DockApiEvents> {
      return Object.freeze({ contract, handlers: Object.freeze(handlers) })
    }
  } as ApiContractClass<"Dock", DockApiSpec, DockApiEvents>

  return Object.freeze(contract)
})()

export const registerDockApi = (): Effect.Effect<
  ApiContractClass<"Dock", DockApiSpec, DockApiEvents>,
  ApiContractError,
  never
> =>
  Effect.gen(function* () {
    const existing = yield* Api.get("Dock")
    if (Option.isSome(existing)) {
      return existing.value as ApiContractClass<"Dock", DockApiSpec, DockApiEvents>
    }
    return yield* Api.Tag("Dock")<unknown>()(DockApiSpec, DockApiEvents)
  })

export const DockMethodNames = Object.freeze(
  Object.keys(DockApiSpec) as ReadonlyArray<keyof DockApiSpec>
)

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
  exchange: ApiClientExchange,
  options: ApiClientOptions = {}
): Layer.Layer<DockClient> => Layer.succeed(DockClient)(makeDockBridgeClient(exchange, options))

export const makeHostDockApiLayer = <Handlers extends ApiHandlers<DockApiSpec>>(
  handlers: Handlers
): ApiLayer<"Dock", DockApiSpec, Handlers, DockApiEvents> => DockApi.layer(handlers)

const makeDockBridgeClient = (
  exchange: ApiClientExchange,
  options: ApiClientOptions
): DockClientApi => {
  const client = Client({ Dock: DockApi }, exchange, options).Dock
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
    isSupported: (method) =>
      Effect.succeed(
        new DockSupportedResult({
          supported:
            method === "setBadgeCount" || method === "setProgress" || method === "requestAttention"
        })
      )
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

function dockMethodSpec<Input extends Schema.Schema<unknown>>(input: Input, permission: string) {
  return { input, output: Schema.Void, error: HostProtocolErrorSchema, permission } as const
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
