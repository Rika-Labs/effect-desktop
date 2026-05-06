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
  ApiResourceHandleShape,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"

import {
  TrayActivatedEvent,
  TrayCreateInput,
  type TrayCreateOptions,
  TrayDestroyInput,
  type TrayHandle,
  TrayResource,
  TraySetIconInput,
  TraySetMenuInput,
  TraySetTooltipInput
} from "./contracts/tray.js"
import type { MenuTemplateOptions } from "./menu.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

export type TrayError = HostProtocolError

export const TrayApiSpec = Object.freeze({
  create: {
    input: TrayCreateInput,
    output: TrayResource,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:Tray.create"
  },
  setIcon: trayMethodSpec(TraySetIconInput, "native.invoke:Tray.setIcon"),
  setTooltip: trayMethodSpec(TraySetTooltipInput, "native.invoke:Tray.setTooltip"),
  setMenu: trayMethodSpec(TraySetMenuInput, "native.invoke:Tray.setMenu"),
  destroy: trayMethodSpec(TrayDestroyInput, "native.invoke:Tray.destroy")
}) satisfies ApiContractSpec

export type TrayApiSpec = typeof TrayApiSpec

export const TrayApiEvents = Object.freeze({
  Activated: { payload: TrayActivatedEvent }
})

export type TrayApiEvents = typeof TrayApiEvents

export const TrayApi: ApiContractClass<"Tray", TrayApiSpec, TrayApiEvents> = (() => {
  const contract = class {
    static readonly tag = "Tray"
    static readonly spec = TrayApiSpec
    static readonly events = TrayApiEvents

    static layer<Handlers extends ApiHandlers<TrayApiSpec>>(
      handlers: Handlers
    ): ApiLayer<"Tray", TrayApiSpec, Handlers, TrayApiEvents> {
      return Object.freeze({
        contract,
        handlers: Object.freeze(handlers)
      })
    }
  } as ApiContractClass<"Tray", TrayApiSpec, TrayApiEvents>

  return Object.freeze(contract)
})()

export const registerTrayApi = (): Effect.Effect<
  ApiContractClass<"Tray", TrayApiSpec, TrayApiEvents>,
  ApiContractError,
  never
> =>
  Effect.gen(function* () {
    const existing = yield* Api.get("Tray")
    if (Option.isSome(existing)) {
      return existing.value as ApiContractClass<"Tray", TrayApiSpec, TrayApiEvents>
    }

    return yield* Api.Tag("Tray")<unknown>()(TrayApiSpec, TrayApiEvents)
  })

export const TrayMethodNames = Object.freeze(
  Object.keys(TrayApiSpec) as ReadonlyArray<keyof TrayApiSpec>
)

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
}

export class TrayClient extends Context.Service<TrayClient, TrayClientApi>()(
  "@effect-desktop/native/TrayClient"
) {}

export type TrayServiceApi = TrayClientApi

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
      onActivated: () => client.onActivated()
    } satisfies TrayServiceApi)
  })
)

export const makeTrayClientLayer = (client: TrayClientApi): Layer.Layer<TrayClient> =>
  Layer.succeed(TrayClient)(client)

export const makeTrayServiceLayer = (client: TrayClientApi): Layer.Layer<Tray> =>
  Layer.provide(TrayLive, makeTrayClientLayer(client))

export const makeTrayBridgeClientLayer = (
  exchange: ApiClientExchange,
  options: ApiClientOptions = {}
): Layer.Layer<TrayClient> => Layer.succeed(TrayClient)(makeTrayBridgeClient(exchange, options))

export const makeHostTrayApiLayer = <Handlers extends ApiHandlers<TrayApiSpec>>(
  handlers: Handlers
): ApiLayer<"Tray", TrayApiSpec, Handlers, TrayApiEvents> => TrayApi.layer(handlers)

const makeTrayBridgeClient = (
  exchange: ApiClientExchange,
  options: ApiClientOptions
): TrayClientApi => {
  const client = Client({ Tray: TrayApi }, exchange, options).Tray

  const trayClient: TrayClientApi = {
    create: (input) => decodeTrayCreateInput(input).pipe(Effect.flatMap(client.create)),
    setIcon: (tray, icon) =>
      decodeTraySetIconInput({ tray: toTrayHandle(tray), icon }).pipe(
        Effect.flatMap(client.setIcon)
      ),
    setTooltip: (tray, tooltip) =>
      decodeTraySetTooltipInput({ tray: toTrayHandle(tray), tooltip }).pipe(
        Effect.flatMap(client.setTooltip)
      ),
    setMenu: (tray, menu) =>
      decodeTraySetMenuInput({ tray: toTrayHandle(tray), menu }).pipe(
        Effect.flatMap(client.setMenu)
      ),
    destroy: (tray) => client.destroy(new TrayDestroyInput({ tray: toTrayHandle(tray) })),
    onActivated: () => client.events.Activated
  }

  return Object.freeze(trayClient)
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
    onActivated: () => unsupportedStream<TrayActivatedEvent>("Tray.Activated")
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
  new ApiResourceHandleShape({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  }) as TrayHandle

const decodeTrayCreateInput = (input: unknown): Effect.Effect<TrayCreateInput, TrayError, never> =>
  decodeInput(TrayCreateInput, input, "Tray.create") as Effect.Effect<
    TrayCreateInput,
    TrayError,
    never
  >

const decodeTraySetIconInput = (
  input: unknown
): Effect.Effect<TraySetIconInput, TrayError, never> =>
  decodeInput(TraySetIconInput, input, "Tray.setIcon") as Effect.Effect<
    TraySetIconInput,
    TrayError,
    never
  >

const decodeTraySetTooltipInput = (
  input: unknown
): Effect.Effect<TraySetTooltipInput, TrayError, never> =>
  decodeInput(TraySetTooltipInput, input, "Tray.setTooltip") as Effect.Effect<
    TraySetTooltipInput,
    TrayError,
    never
  >

const decodeTraySetMenuInput = (
  input: unknown
): Effect.Effect<TraySetMenuInput, TrayError, never> =>
  decodeInput(TraySetMenuInput, input, "Tray.setMenu") as Effect.Effect<
    TraySetMenuInput,
    TrayError,
    never
  >

const decodeInput = (
  schema: Schema.Schema<unknown>,
  input: unknown,
  operation: string
): Effect.Effect<unknown, TrayError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(schema)(input, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

function trayMethodSpec<Input extends Schema.Schema<unknown>>(input: Input, permission: string) {
  return {
    input,
    output: Schema.Void,
    error: HostProtocolErrorSchema,
    permission
  } as const
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
