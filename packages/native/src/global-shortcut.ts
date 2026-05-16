import {
  P,
  type DesktopRpcClient,
  CommandRegistry,
  makeResourceId,
  PermissionActor,
  PermissionContext,
  type CommandRegistryError,
  type PermissionRegistry,
  type ResourceHandle,
  type ResourceId,
  type ResourceRegistry
} from "@effect-desktop/core"
import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolAlreadyExistsError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
import { subscribeNativeEvent } from "./event-stream.js"
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
  P.nativeInvoke({ primitive: "GlobalShortcut", methods: ["register"] })
)
export const GlobalShortcutUnregister = shortcutRpc(
  "unregister",
  GlobalShortcutAcceleratorInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "GlobalShortcut", methods: ["unregister"] })
)
export const GlobalShortcutUnregisterAll = shortcutRpc(
  "unregisterAll",
  Schema.Void,
  Schema.Void,
  P.nativeInvoke({ primitive: "GlobalShortcut", methods: ["unregisterAll"] })
)
export const GlobalShortcutIsRegistered = shortcutRpc(
  "isRegistered",
  GlobalShortcutAcceleratorInput,
  GlobalShortcutRegisteredResult,
  { kind: "none" }
)
export const GlobalShortcutIsSupported = shortcutRpc(
  "isSupported",
  Schema.Void,
  GlobalShortcutSupportedOutput,
  { kind: "none" }
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

const GlobalShortcutCapabilityMethods = Object.freeze([
  "register",
  "unregister",
  "unregisterAll"
] as const satisfies readonly (typeof GlobalShortcutMethodNames)[number][])

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
) {
  static readonly layer = Layer.effect(GlobalShortcut)(
    Effect.gen(function* () {
      const client = yield* GlobalShortcutClient
      return GlobalShortcut.of({
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
}

export const GlobalShortcutLive = GlobalShortcut.layer

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
      Effect.tapError((error: CommandRegistryError) =>
        Effect.logWarning("GlobalShortcut command invocation failed", {
          accelerator,
          commandId,
          error: commandBindingWarningError(error),
          windowId
        })
      ),
      Effect.ignore
    )

const logGlobalShortcutCleanupFailure =
  (
    accelerator: string,
    phase: "scope-dispose"
  ): (<A>(
    effect: Effect.Effect<A, GlobalShortcutError, never>
  ) => Effect.Effect<void, never, never>) =>
  (effect) =>
    effect.pipe(
      Effect.tapError((error: GlobalShortcutError) =>
        Effect.logWarning("GlobalShortcut cleanup failed", {
          accelerator,
          error: commandBindingWarningError(error),
          phase
        })
      ),
      Effect.ignore
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
): Layer.Layer<GlobalShortcutClient> => GlobalShortcutSurface.bridgeClientLayer(exchange, options)

export type GlobalShortcutRpc = RpcGroup.Rpcs<typeof GlobalShortcutRpcGroup>

export type GlobalShortcutRpcHandlers = RpcGroup.HandlersFrom<GlobalShortcutRpc>

export const GlobalShortcutHandlersLive = GlobalShortcutRpcGroup.toLayer({
  "GlobalShortcut.register": (input) =>
    Effect.gen(function* () {
      const shortcuts = yield* GlobalShortcut
      yield* shortcuts.register(input.accelerator, input.registrarWindow)
    }),
  "GlobalShortcut.unregister": (input) =>
    Effect.gen(function* () {
      const shortcuts = yield* GlobalShortcut
      yield* shortcuts.unregister(input.accelerator)
    }),
  "GlobalShortcut.unregisterAll": () =>
    Effect.gen(function* () {
      const shortcuts = yield* GlobalShortcut
      yield* shortcuts.unregisterAll()
    }),
  "GlobalShortcut.isRegistered": (input) =>
    Effect.gen(function* () {
      const shortcuts = yield* GlobalShortcut
      const registered = yield* shortcuts.isRegistered(input.accelerator)
      return new GlobalShortcutRegisteredResult({ registered })
    }),
  "GlobalShortcut.isSupported": () =>
    Effect.gen(function* () {
      const shortcuts = yield* GlobalShortcut
      return yield* shortcuts.isSupported()
    })
})

export const GlobalShortcutSurface = NativeSurface.make("GlobalShortcut", GlobalShortcutRpcGroup, {
  service: GlobalShortcutClient,
  capabilities: GlobalShortcutCapabilityMethods,
  handlers: GlobalShortcutHandlersLive,
  client: (client) => globalShortcutClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => globalShortcutClientFromRpcClient(client, exchange)
})

export const makeHostGlobalShortcutRpcRuntime = (
  handlers: GlobalShortcutRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  GlobalShortcutSurface.hostRuntime(handlers, runtimeOptions)

const globalShortcutClientFromRpcClient = (
  client: DesktopRpcClient<GlobalShortcutRpc>,
  exchange: BridgeClientExchange | undefined
): GlobalShortcutClientApi => {
  return Object.freeze({
    register: (accelerator, registrarWindow) =>
      decodeGlobalShortcutRegisterInput({
        accelerator,
        registrarWindow: toWindowHandle(registrarWindow)
      }).pipe(
        Effect.flatMap((decoded) =>
          runGlobalShortcutRpc(
            client["GlobalShortcut.register"](decoded),
            "GlobalShortcut.register"
          )
        )
      ),
    unregister: (accelerator) =>
      decodeGlobalShortcutAcceleratorInput({ accelerator }).pipe(
        Effect.flatMap((decoded) =>
          runGlobalShortcutRpc(
            client["GlobalShortcut.unregister"](decoded),
            "GlobalShortcut.unregister"
          )
        )
      ),
    unregisterAll: () =>
      runGlobalShortcutRpc(
        client["GlobalShortcut.unregisterAll"](undefined),
        "GlobalShortcut.unregisterAll"
      ),
    isRegistered: (accelerator) =>
      decodeGlobalShortcutAcceleratorInput({ accelerator }).pipe(
        Effect.flatMap((decoded) =>
          runGlobalShortcutRpc(
            client["GlobalShortcut.isRegistered"](decoded),
            "GlobalShortcut.isRegistered"
          )
        )
      ),
    isSupported: () =>
      runGlobalShortcutRpc(
        client["GlobalShortcut.isSupported"](undefined),
        "GlobalShortcut.isSupported"
      ),
    onPressed: () => subscribeGlobalShortcutEvent(exchange, "GlobalShortcut.Pressed")
  } satisfies GlobalShortcutClientApi)
}

const subscribeGlobalShortcutEvent = (
  exchange: BridgeClientExchange | undefined,
  method: "GlobalShortcut.Pressed"
): Stream.Stream<GlobalShortcutPressedEvent, GlobalShortcutError, never> =>
  subscribeNativeEvent(exchange, method, GlobalShortcutPressedEvent)

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
  makeResourceId(`global-shortcut-command:${windowId}:${accelerator}`)

const toWindowHandle = (handle: GlobalShortcutWindowHandle): GlobalShortcutWindowHandle =>
  Object.freeze({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  })

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
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc("GlobalShortcut", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })
}

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
