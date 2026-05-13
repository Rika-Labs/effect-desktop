import {
  type DesktopRpcClient,
  CommandRegistry,
  PermissionActor,
  PermissionContext,
  type CommandRegistryError,
  type ResourceHandle,
  type ResourceId,
  type ResourceRegistry
} from "@effect-desktop/core"
import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolEventEnvelope,
  HostProtocolAlreadyExistsError,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeDesktopClientProtocol,
  makeDesktopRpcHandlerRuntime,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  Rpc,
  RpcClient,
  RpcCapability,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { bindScopedCommand } from "./command-binding.js"
import {
  GlobalShortcutAcceleratorInput,
  GlobalShortcutPressedEvent,
  GlobalShortcutRegisteredResult,
  GlobalShortcutRegisterInput,
  type GlobalShortcutSupportReason,
  GlobalShortcutSupportedOutput,
  GlobalShortcutSupportedResult
} from "./contracts/global-shortcut.js"
import { commandBindingWarningError } from "./command-binding-log.js"
import type { WindowHandle } from "./window.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

export type GlobalShortcutError = HostProtocolError
export type GlobalShortcutWindowHandle = WindowHandle
export type GlobalShortcutCommandBindingError = GlobalShortcutError | CommandRegistryError

export const GlobalShortcutRegister = shortcutRpc(
  "register",
  GlobalShortcutRegisterInput,
  Schema.Void,
  "native.invoke:GlobalShortcut.register"
)
export const GlobalShortcutUnregister = shortcutRpc(
  "unregister",
  GlobalShortcutAcceleratorInput,
  Schema.Void,
  "native.invoke:GlobalShortcut.unregister"
)
export const GlobalShortcutUnregisterAll = shortcutRpc(
  "unregisterAll",
  Schema.Void,
  Schema.Void,
  "native.invoke:GlobalShortcut.unregisterAll"
)
export const GlobalShortcutIsRegistered = shortcutRpc(
  "isRegistered",
  GlobalShortcutAcceleratorInput,
  GlobalShortcutRegisteredResult,
  "none"
)
export const GlobalShortcutIsSupported = shortcutRpc(
  "isSupported",
  Schema.Void,
  GlobalShortcutSupportedOutput,
  "none"
)

export const GlobalShortcutRpcEvents = Object.freeze({
  Pressed: { payload: GlobalShortcutPressedEvent }
})

export type GlobalShortcutRpcEvents = typeof GlobalShortcutRpcEvents

const GlobalShortcutRpcGroup = RpcGroup.make(
  GlobalShortcutRegister,
  GlobalShortcutUnregister,
  GlobalShortcutUnregisterAll,
  GlobalShortcutIsRegistered,
  GlobalShortcutIsSupported
)

export const GlobalShortcutRpcs: RpcGroup.RpcGroup<GlobalShortcutRpc> = GlobalShortcutRpcGroup

export const GlobalShortcutMethodNames = Object.freeze([
  "register",
  "unregister",
  "unregisterAll",
  "isRegistered",
  "isSupported"
] as const)

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
  readonly bindCommand: (
    accelerator: string,
    commandId: string,
    registrarWindow: GlobalShortcutWindowHandle
  ) => Effect.Effect<
    ResourceHandle<"global-shortcut-command", "registered">,
    GlobalShortcutCommandBindingError,
    CommandRegistry | ResourceRegistry
  >
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
      bindCommand: (accelerator, commandId, registrarWindow) =>
        bindGlobalShortcutCommand(client, accelerator, commandId, registrarWindow),
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

const bindGlobalShortcutCommand = (
  client: GlobalShortcutClientApi,
  accelerator: string,
  commandId: string,
  registrarWindow: GlobalShortcutWindowHandle
): Effect.Effect<
  ResourceHandle<"global-shortcut-command", "registered">,
  GlobalShortcutCommandBindingError,
  CommandRegistry | ResourceRegistry
> => {
  return Effect.gen(function* () {
    const commands = yield* CommandRegistry
    const registrar = toWindowHandle(registrarWindow)
    return yield* bindScopedCommand({
      kind: "global-shortcut-command",
      id: globalShortcutCommandResourceId(registrar.id, accelerator),
      ownerScope: registrar.ownerScope,
      register: client.register(accelerator, registrar),
      events: client
        .onPressed()
        .pipe(
          Stream.filter(
            (event) => event.accelerator === accelerator && event.registrarWindowId === registrar.id
          )
        ),
      invoke: () => invokeGlobalShortcutCommand(commands, commandId, registrar.id, accelerator),
      release: client
        .unregister(accelerator)
        .pipe(logGlobalShortcutCleanupFailure(accelerator, "scope-dispose"))
    })
  })
}

const invokeGlobalShortcutCommand = (
  commands: CommandRegistry["Service"],
  commandId: string,
  windowId: string,
  accelerator: string
): Effect.Effect<void, never, never> =>
  commands
    .invoke(
      commandId,
      undefined,
      new PermissionContext({
        actor: new PermissionActor({ kind: "window", id: windowId }),
        traceId: `global-shortcut:${windowId}:${accelerator}`
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: CommandRegistryError) =>
        Effect.logWarning("GlobalShortcut command invocation failed", {
          accelerator,
          commandId,
          error: commandBindingWarningError(error),
          windowId
        })
      )
    )

const logGlobalShortcutCleanupFailure =
  (
    accelerator: string,
    phase: "scope-dispose"
  ): (<A>(
    effect: Effect.Effect<A, GlobalShortcutError, never>
  ) => Effect.Effect<A | void, never, never>) =>
  (effect) =>
    effect.pipe(
      Effect.catch((error: GlobalShortcutError) =>
        Effect.logWarning("GlobalShortcut cleanup failed", {
          accelerator,
          error: commandBindingWarningError(error),
          phase
        })
      )
    )

export const makeGlobalShortcutClientLayer = (
  client: GlobalShortcutClientApi
): Layer.Layer<GlobalShortcutClient> => Layer.succeed(GlobalShortcutClient)(client)

export const makeGlobalShortcutServiceLayer = (
  client: GlobalShortcutClientApi
): Layer.Layer<GlobalShortcut> =>
  Layer.provide(GlobalShortcutLive, makeGlobalShortcutClientLayer(client))

export const makeGlobalShortcutBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<GlobalShortcutClient> =>
  Layer.succeed(GlobalShortcutClient)(makeGlobalShortcutBridgeClient(exchange, options))

export type GlobalShortcutRpc = RpcGroup.Rpcs<typeof GlobalShortcutRpcGroup>

export type GlobalShortcutRpcHandlers = Parameters<typeof GlobalShortcutRpcGroup.toLayer>[0]

export const makeHostGlobalShortcutRpcRuntime = (
  handlers: GlobalShortcutRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<unknown> =>
  makeDesktopRpcHandlerRuntime(
    GlobalShortcutRpcGroup,
    GlobalShortcutRpcGroup.toLayer(handlers),
    runtimeOptions
  )

const makeGlobalShortcutBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): GlobalShortcutClientApi => {
  return Object.freeze({
    register: (accelerator, registrarWindow) =>
      decodeGlobalShortcutRegisterInput({
        accelerator,
        registrarWindow: toWindowHandle(registrarWindow)
      }).pipe(
        Effect.flatMap((decoded) =>
          withGlobalShortcutRpcClient(exchange, options, (client) =>
            runGlobalShortcutRpc(
              client["GlobalShortcut.register"](decoded),
              "GlobalShortcut.register"
            )
          )
        )
      ),
    unregister: (accelerator) =>
      decodeGlobalShortcutAcceleratorInput({ accelerator }).pipe(
        Effect.flatMap((decoded) =>
          withGlobalShortcutRpcClient(exchange, options, (client) =>
            runGlobalShortcutRpc(
              client["GlobalShortcut.unregister"](decoded),
              "GlobalShortcut.unregister"
            )
          )
        )
      ),
    unregisterAll: () =>
      withGlobalShortcutRpcClient(exchange, options, (client) =>
        runGlobalShortcutRpc(
          client["GlobalShortcut.unregisterAll"](undefined),
          "GlobalShortcut.unregisterAll"
        )
      ),
    isRegistered: (accelerator) =>
      decodeGlobalShortcutAcceleratorInput({ accelerator }).pipe(
        Effect.flatMap((decoded) =>
          withGlobalShortcutRpcClient(exchange, options, (client) =>
            runGlobalShortcutRpc(
              client["GlobalShortcut.isRegistered"](decoded),
              "GlobalShortcut.isRegistered"
            )
          )
        )
      ),
    isSupported: () =>
      withGlobalShortcutRpcClient(exchange, options, (client) =>
        runGlobalShortcutRpc(
          client["GlobalShortcut.isSupported"](undefined),
          "GlobalShortcut.isSupported"
        )
      ),
    onPressed: () => subscribeGlobalShortcutEvent(exchange, "GlobalShortcut.Pressed")
  } satisfies GlobalShortcutClientApi)
}

const makeGlobalShortcutBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const withGlobalShortcutRpcClient = <A>(
  exchange: BridgeClientExchange,
  options: BridgeClientOptions,
  use: (client: GlobalShortcutRpcClient) => Effect.Effect<A, GlobalShortcutError, never>
): Effect.Effect<A, GlobalShortcutError, never> =>
  Effect.scoped(
    RpcClient.make(GlobalShortcutRpcGroup).pipe(
      Effect.flatMap(use),
      Effect.provide(makeGlobalShortcutBridgeProtocolLayer(exchange, options))
    )
  )

const subscribeGlobalShortcutEvent = (
  exchange: BridgeClientExchange,
  method: "GlobalShortcut.Pressed"
): Stream.Stream<GlobalShortcutPressedEvent, GlobalShortcutError, never> => {
  if (exchange.subscribe === undefined) {
    return Stream.fail(
      makeHostProtocolInvalidOutputError(method, "event exchange does not support subscriptions")
    )
  }

  return exchange
    .subscribe(method)
    .pipe(Stream.mapEffect((envelope) => decodeGlobalShortcutEventEnvelope(method, envelope)))
}

const decodeGlobalShortcutEventEnvelope = (
  operation: string,
  envelope: HostProtocolEventEnvelope
): Effect.Effect<GlobalShortcutPressedEvent, GlobalShortcutError, never> => {
  if (envelope.method !== operation) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(operation, `unexpected event method: ${envelope.method}`)
    )
  }

  return Schema.decodeUnknownEffect(GlobalShortcutPressedEvent)(envelope.payload).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )
}

export const makeUnsupportedGlobalShortcutClient = (): GlobalShortcutClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, GlobalShortcutError, never> =>
    Effect.fail(unsupportedError(method, "host-adapter-unimplemented"))
  const unsupportedStream = <A>(method: string): Stream.Stream<A, GlobalShortcutError, never> =>
    Stream.fail(unsupportedError(method))
  return Object.freeze({
    register: () => unsupportedEffect<void>("GlobalShortcut.register"),
    unregister: () => unsupportedEffect<void>("GlobalShortcut.unregister"),
    unregisterAll: () => unsupportedEffect<void>("GlobalShortcut.unregisterAll"),
    isRegistered: () =>
      unsupportedEffect<GlobalShortcutRegisteredResult>("GlobalShortcut.isRegistered"),
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

export const makeLinuxGlobalShortcutClient = (
  sessionType = process.env["XDG_SESSION_TYPE"]
): GlobalShortcutClientApi => {
  const support = linuxGlobalShortcutSupport(sessionType)
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, GlobalShortcutError, never> =>
    Effect.fail(unsupportedError(method, support.reason ?? "host-adapter-unimplemented"))
  const unsupportedStream = <A>(method: string): Stream.Stream<A, GlobalShortcutError, never> =>
    Stream.fail(unsupportedError(method, support.reason ?? "host-adapter-unimplemented"))

  return Object.freeze({
    register: () => unsupportedEffect<void>("GlobalShortcut.register"),
    unregister: () => unsupportedEffect<void>("GlobalShortcut.unregister"),
    unregisterAll: () => unsupportedEffect<void>("GlobalShortcut.unregisterAll"),
    isRegistered: () => Effect.succeed(new GlobalShortcutRegisteredResult({ registered: false })),
    isSupported: () => Effect.succeed(support),
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

const unsupportedError = (
  method: string,
  reason: GlobalShortcutSupportReason = "host-adapter-unimplemented"
): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason,
    message: `unsupported GlobalShortcut method: ${method}`,
    operation: method,
    recoverable: false
  })

const linuxGlobalShortcutSupport = (
  sessionType: string | undefined
): GlobalShortcutSupportedResult => {
  const normalized = sessionType?.toLowerCase()
  if (normalized === "wayland") {
    return new GlobalShortcutSupportedResult({
      supported: false,
      reason: "wayland-no-global-shortcut"
    })
  }
  if (normalized === "x11") {
    return new GlobalShortcutSupportedResult({ supported: true })
  }
  return new GlobalShortcutSupportedResult({
    supported: false,
    reason: "host-adapter-unimplemented"
  })
}

const globalShortcutCommandResourceId = (windowId: string, accelerator: string): ResourceId =>
  `global-shortcut-command:${windowId}:${accelerator}` as ResourceId

const toWindowHandle = (handle: GlobalShortcutWindowHandle): GlobalShortcutWindowHandle =>
  Object.freeze({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  }) as GlobalShortcutWindowHandle

const decodeGlobalShortcutRegisterInput = (
  input: unknown
): Effect.Effect<GlobalShortcutRegisterInput, GlobalShortcutError, never> =>
  decodeInput(GlobalShortcutRegisterInput, input, "GlobalShortcut.register")

const decodeGlobalShortcutAcceleratorInput = (
  input: unknown
): Effect.Effect<GlobalShortcutAcceleratorInput, GlobalShortcutError, never> =>
  decodeInput(GlobalShortcutAcceleratorInput, input, "GlobalShortcut.accelerator")

const decodeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, GlobalShortcutError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

function shortcutRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: string) {
  return Rpc.make(`GlobalShortcut.${method}` as const, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}

type GlobalShortcutRpcClient = DesktopRpcClient<GlobalShortcutRpc>

const runGlobalShortcutRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, GlobalShortcutError, never> =>
  effect.pipe(
    Effect.mapError(mapGlobalShortcutRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapGlobalShortcutRpcClientError = (error: unknown): GlobalShortcutError =>
  isGlobalShortcutError(error)
    ? error
    : makeHostProtocolInternalError("GlobalShortcut RPC client failed", "GlobalShortcut")

const isGlobalShortcutError = (error: unknown): error is GlobalShortcutError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
