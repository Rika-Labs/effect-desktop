import {
  CommandRegistry,
  PermissionActor,
  PermissionContext,
  ResourceRegistry,
  type CommandRegistryError,
  type ResourceHandle,
  type ResourceId
} from "@effect-desktop/core"
import {
  BridgeRpc,
  Client,
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeRpcGroup,
  type BridgeRpcSpec,
  type BridgeRpcHandlers,
  type BridgeRpcLayer,
  BridgeResourceHandleShape,
  HostProtocolAlreadyExistsError,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Fiber, Layer, Schema, Stream } from "effect"

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

export const GlobalShortcutRpcSpec = Object.freeze({
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
    output: GlobalShortcutSupportedOutput,
    error: HostProtocolErrorSchema,
    permission: "none"
  }
}) satisfies BridgeRpcSpec

export type GlobalShortcutRpcSpec = typeof GlobalShortcutRpcSpec

export const GlobalShortcutRpcEvents = Object.freeze({
  Pressed: { payload: GlobalShortcutPressedEvent }
})

export type GlobalShortcutRpcEvents = typeof GlobalShortcutRpcEvents

export const GlobalShortcutRpcs: BridgeRpcGroup<
  "GlobalShortcut",
  GlobalShortcutRpcSpec,
  GlobalShortcutRpcEvents
> = BridgeRpc.group("GlobalShortcut", GlobalShortcutRpcSpec, GlobalShortcutRpcEvents)

export const GlobalShortcutMethodNames = Object.freeze(
  Object.keys(GlobalShortcutRpcSpec) as ReadonlyArray<keyof GlobalShortcutRpcSpec>
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
  let completed = false
  let registered = false

  return Effect.gen(function* () {
    const commands = yield* CommandRegistry
    const resources = yield* ResourceRegistry
    const registrar = toWindowHandle(registrarWindow)
    yield* client.register(accelerator, registrar)
    registered = true

    const fiber = yield* client.onPressed().pipe(
      Stream.filter(
        (event) => event.accelerator === accelerator && event.registrarWindowId === registrar.id
      ),
      Stream.runForEach(() =>
        invokeGlobalShortcutCommand(commands, commandId, registrar.id, accelerator)
      ),
      Effect.forkDetach
    )

    const cleanup = cleanupGlobalShortcutCommandBinding(client, fiber, accelerator)

    const handle = yield* resources
      .register({
        kind: "global-shortcut-command",
        id: globalShortcutCommandResourceId(registrar.id, accelerator),
        ownerScope: registrar.ownerScope,
        state: "registered",
        dispose: cleanup
      })
      .pipe(Effect.orDie)
    completed = true
    return handle
  }).pipe(
    Effect.ensuring(
      Effect.suspend(() =>
        completed || !registered
          ? Effect.void
          : client
              .unregister(accelerator)
              .pipe(logGlobalShortcutCleanupFailure(accelerator, "registration-rollback"))
      )
    )
  )
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

const cleanupGlobalShortcutCommandBinding = (
  client: GlobalShortcutClientApi,
  fiber: Fiber.Fiber<void, GlobalShortcutError | CommandRegistryError>,
  accelerator: string
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    yield* Fiber.interrupt(fiber)
    yield* client
      .unregister(accelerator)
      .pipe(logGlobalShortcutCleanupFailure(accelerator, "scope-dispose"))
  })

const logGlobalShortcutCleanupFailure =
  (
    accelerator: string,
    phase: "registration-rollback" | "scope-dispose"
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

export const makeHostGlobalShortcutBridgeRpcLayer = <
  Handlers extends BridgeRpcHandlers<GlobalShortcutRpcSpec>
>(
  handlers: Handlers
): BridgeRpcLayer<"GlobalShortcut", GlobalShortcutRpcSpec, Handlers, GlobalShortcutRpcEvents> =>
  BridgeRpc.layer(GlobalShortcutRpcs)(handlers)

const makeGlobalShortcutBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): GlobalShortcutClientApi => {
  const client = Client({ GlobalShortcut: GlobalShortcutRpcs }, exchange, options).GlobalShortcut
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
  new BridgeResourceHandleShape({
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
