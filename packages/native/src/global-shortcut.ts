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
  HostProtocolAlreadyExistsError,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"

import {
  GlobalShortcutAcceleratorInput,
  GlobalShortcutPressedEvent,
  GlobalShortcutRegisteredResult,
  GlobalShortcutRegisterInput,
  GlobalShortcutSupportedResult
} from "./contracts/global-shortcut.js"
import type { WindowHandle } from "./window.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

export type GlobalShortcutError = HostProtocolError
export type GlobalShortcutWindowHandle = WindowHandle

export const GlobalShortcutApiSpec = Object.freeze({
  register: shortcutMethodSpec(
    GlobalShortcutRegisterInput,
    "native.invoke:GlobalShortcut.register"
  ),
  unregister: shortcutMethodSpec(
    GlobalShortcutAcceleratorInput,
    "native.invoke:GlobalShortcut.unregister"
  ),
  unregisterAll: {
    input: Schema.Void,
    output: Schema.Void,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:GlobalShortcut.unregisterAll"
  },
  isRegistered: {
    input: GlobalShortcutAcceleratorInput,
    output: GlobalShortcutRegisteredResult,
    error: HostProtocolErrorSchema,
    permission: "none"
  },
  isSupported: {
    input: Schema.Void,
    output: GlobalShortcutSupportedResult,
    error: HostProtocolErrorSchema,
    permission: "none"
  }
}) satisfies ApiContractSpec

export type GlobalShortcutApiSpec = typeof GlobalShortcutApiSpec

export const GlobalShortcutApiEvents = Object.freeze({
  Pressed: { payload: GlobalShortcutPressedEvent }
})

export type GlobalShortcutApiEvents = typeof GlobalShortcutApiEvents

export const GlobalShortcutApi: ApiContractClass<
  "GlobalShortcut",
  GlobalShortcutApiSpec,
  GlobalShortcutApiEvents
> = (() => {
  const contract = class {
    static readonly tag = "GlobalShortcut"
    static readonly spec = GlobalShortcutApiSpec
    static readonly events = GlobalShortcutApiEvents

    static layer<Handlers extends ApiHandlers<GlobalShortcutApiSpec>>(
      handlers: Handlers
    ): ApiLayer<"GlobalShortcut", GlobalShortcutApiSpec, Handlers, GlobalShortcutApiEvents> {
      return Object.freeze({ contract, handlers: Object.freeze(handlers) })
    }
  } as ApiContractClass<"GlobalShortcut", GlobalShortcutApiSpec, GlobalShortcutApiEvents>

  return Object.freeze(contract)
})()

export const registerGlobalShortcutApi = (): Effect.Effect<
  ApiContractClass<"GlobalShortcut", GlobalShortcutApiSpec, GlobalShortcutApiEvents>,
  ApiContractError,
  never
> =>
  Effect.gen(function* () {
    const existing = yield* Api.get("GlobalShortcut")
    if (Option.isSome(existing)) {
      return existing.value as ApiContractClass<
        "GlobalShortcut",
        GlobalShortcutApiSpec,
        GlobalShortcutApiEvents
      >
    }
    return yield* Api.Tag("GlobalShortcut")<unknown>()(
      GlobalShortcutApiSpec,
      GlobalShortcutApiEvents
    )
  })

export const GlobalShortcutMethodNames = Object.freeze(
  Object.keys(GlobalShortcutApiSpec) as ReadonlyArray<keyof GlobalShortcutApiSpec>
)

export interface GlobalShortcutClientApi {
  readonly register: (
    accelerator: string,
    registrarWindow: GlobalShortcutWindowHandle
  ) => Effect.Effect<void, GlobalShortcutError, never>
  readonly unregister: (accelerator: string) => Effect.Effect<void, GlobalShortcutError, never>
  readonly unregisterAll: () => Effect.Effect<void, GlobalShortcutError, never>
  readonly isRegistered: (
    accelerator: string
  ) => Effect.Effect<GlobalShortcutRegisteredResult, GlobalShortcutError, never>
  readonly isSupported: () => Effect.Effect<
    GlobalShortcutSupportedResult,
    GlobalShortcutError,
    never
  >
  readonly onPressed: () => Stream.Stream<GlobalShortcutPressedEvent, GlobalShortcutError, never>
}

export class GlobalShortcutClient extends Context.Service<
  GlobalShortcutClient,
  GlobalShortcutClientApi
>()("@effect-desktop/native/GlobalShortcutClient") {}

export interface GlobalShortcutServiceApi extends Omit<
  GlobalShortcutClientApi,
  "isRegistered" | "isSupported"
> {
  readonly isRegistered: (accelerator: string) => Effect.Effect<boolean, GlobalShortcutError, never>
  readonly isSupported: () => Effect.Effect<
    GlobalShortcutSupportedResult,
    GlobalShortcutError,
    never
  >
}

export class GlobalShortcut extends Context.Service<GlobalShortcut, GlobalShortcutServiceApi>()(
  "@effect-desktop/native/GlobalShortcut"
) {}

export const GlobalShortcutLive = Layer.effect(GlobalShortcut)(
  Effect.gen(function* () {
    const client = yield* GlobalShortcutClient
    return Object.freeze({
      register: (accelerator, registrarWindow) => client.register(accelerator, registrarWindow),
      unregister: (accelerator) => client.unregister(accelerator),
      unregisterAll: () => client.unregisterAll(),
      isRegistered: (accelerator) =>
        client.isRegistered(accelerator).pipe(Effect.map((result) => result.registered)),
      isSupported: () => client.isSupported(),
      onPressed: () => client.onPressed()
    } satisfies GlobalShortcutServiceApi)
  })
)

export const makeGlobalShortcutClientLayer = (
  client: GlobalShortcutClientApi
): Layer.Layer<GlobalShortcutClient> => Layer.succeed(GlobalShortcutClient)(client)

export const makeGlobalShortcutServiceLayer = (
  client: GlobalShortcutClientApi
): Layer.Layer<GlobalShortcut> =>
  Layer.provide(GlobalShortcutLive, makeGlobalShortcutClientLayer(client))

export const makeGlobalShortcutBridgeClientLayer = (
  exchange: ApiClientExchange,
  options: ApiClientOptions = {}
): Layer.Layer<GlobalShortcutClient> =>
  Layer.succeed(GlobalShortcutClient)(makeGlobalShortcutBridgeClient(exchange, options))

export const makeHostGlobalShortcutApiLayer = <Handlers extends ApiHandlers<GlobalShortcutApiSpec>>(
  handlers: Handlers
): ApiLayer<"GlobalShortcut", GlobalShortcutApiSpec, Handlers, GlobalShortcutApiEvents> =>
  GlobalShortcutApi.layer(handlers)

const makeGlobalShortcutBridgeClient = (
  exchange: ApiClientExchange,
  options: ApiClientOptions
): GlobalShortcutClientApi => {
  const client = Client({ GlobalShortcut: GlobalShortcutApi }, exchange, options).GlobalShortcut
  return Object.freeze({
    register: (accelerator, registrarWindow) =>
      decodeGlobalShortcutRegisterInput({
        accelerator,
        registrarWindow: toWindowHandle(registrarWindow)
      }).pipe(Effect.flatMap(client.register)),
    unregister: (accelerator) =>
      decodeGlobalShortcutAcceleratorInput({ accelerator }).pipe(Effect.flatMap(client.unregister)),
    unregisterAll: () => client.unregisterAll(),
    isRegistered: (accelerator) =>
      decodeGlobalShortcutAcceleratorInput({ accelerator }).pipe(
        Effect.flatMap(client.isRegistered)
      ),
    isSupported: () => client.isSupported(),
    onPressed: () => client.events.Pressed
  } satisfies GlobalShortcutClientApi)
}

export const makeUnsupportedGlobalShortcutClient = (): GlobalShortcutClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, GlobalShortcutError, never> =>
    Effect.fail(unsupportedError(method))
  const unsupportedStream = <A>(method: string): Stream.Stream<A, GlobalShortcutError, never> =>
    Stream.fail(unsupportedError(method))
  return Object.freeze({
    register: () => unsupportedEffect<void>("GlobalShortcut.register"),
    unregister: () => unsupportedEffect<void>("GlobalShortcut.unregister"),
    unregisterAll: () => unsupportedEffect<void>("GlobalShortcut.unregisterAll"),
    isRegistered: () => Effect.succeed(new GlobalShortcutRegisteredResult({ registered: false })),
    isSupported: () =>
      Effect.succeed(
        new GlobalShortcutSupportedResult({
          supported: false,
          reason: "host-adapter-unimplemented"
        })
      ),
    onPressed: () => unsupportedStream<GlobalShortcutPressedEvent>("GlobalShortcut.Pressed")
  } satisfies GlobalShortcutClientApi)
}

export const makeGlobalShortcutAlreadyRegisteredError = (
  accelerator: string,
  operation = "GlobalShortcut.register"
): HostProtocolAlreadyExistsError =>
  new HostProtocolAlreadyExistsError({
    tag: "AlreadyExists",
    resource: accelerator,
    message: `global shortcut already registered: ${accelerator}`,
    operation,
    recoverable: true
  })

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "host-adapter-unimplemented",
    message: `unsupported GlobalShortcut method: ${method}`,
    operation: method,
    recoverable: false
  })

const toWindowHandle = (handle: GlobalShortcutWindowHandle): GlobalShortcutWindowHandle =>
  new ApiResourceHandleShape({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  }) as GlobalShortcutWindowHandle

const decodeGlobalShortcutRegisterInput = (
  input: unknown
): Effect.Effect<GlobalShortcutRegisterInput, GlobalShortcutError, never> =>
  decodeInput(GlobalShortcutRegisterInput, input, "GlobalShortcut.register") as Effect.Effect<
    GlobalShortcutRegisterInput,
    GlobalShortcutError,
    never
  >

const decodeGlobalShortcutAcceleratorInput = (
  input: unknown
): Effect.Effect<GlobalShortcutAcceleratorInput, GlobalShortcutError, never> =>
  decodeInput(GlobalShortcutAcceleratorInput, input, "GlobalShortcut.accelerator") as Effect.Effect<
    GlobalShortcutAcceleratorInput,
    GlobalShortcutError,
    never
  >

const decodeInput = (
  schema: Schema.Schema<unknown>,
  input: unknown,
  operation: string
): Effect.Effect<unknown, GlobalShortcutError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(schema)(input, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

function shortcutMethodSpec<Input extends Schema.Schema<unknown>>(
  input: Input,
  permission: string
) {
  return { input, output: Schema.Void, error: HostProtocolErrorSchema, permission } as const
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
