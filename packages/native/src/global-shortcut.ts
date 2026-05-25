import {
  P,
  type DesktopRpcClient,
  CommandRegistry,
  makeResourceId,
  PermissionActor,
  PermissionContext,
  type CommandRegistryError,
  type ResourceHandle,
  type ResourceId,
  type ResourceRegistry
} from "@orika/core"
import {
  type BridgeClientExchange,
  HostProtocolAlreadyExistsError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type RpcSupportMetadata,
  RpcGroup,
  type HostProtocolError
} from "@orika/bridge"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
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

type GlobalShortcutMethodName = "isRegistered" | "isSupported"

type GlobalShortcutCapabilityMethod = "register" | "unregister" | "unregisterAll"

const HostAdapterUnimplementedReason = "host-adapter-unimplemented"

const GlobalShortcutUnsupportedSupport = NativeSurface.support.unsupported(
  HostAdapterUnimplementedReason,
  {
    platforms: [
      { platform: "macos", status: "unsupported", reason: HostAdapterUnimplementedReason },
      { platform: "windows", status: "unsupported", reason: HostAdapterUnimplementedReason },
      { platform: "linux", status: "unsupported", reason: HostAdapterUnimplementedReason }
    ]
  }
)

const GlobalShortcutSupportByMethod = Object.freeze({
  isRegistered: NativeSurface.support.supported,
  isSupported: NativeSurface.support.supported
} satisfies Record<GlobalShortcutMethodName, RpcSupportMetadata>)

export const GlobalShortcutIsRegistered = NativeSurface.rpc("GlobalShortcut", "isRegistered", {
  payload: GlobalShortcutAcceleratorInput,
  success: GlobalShortcutRegisteredResult,
  authority: NativeSurface.authority.none,
  endpoint: "mutation",
  support: GlobalShortcutSupportByMethod.isRegistered
})
export const GlobalShortcutIsSupported = NativeSurface.rpc("GlobalShortcut", "isSupported", {
  payload: Schema.Void,
  success: GlobalShortcutSupportedOutput,
  authority: NativeSurface.authority.none,
  endpoint: "mutation",
  support: GlobalShortcutSupportByMethod.isSupported
})

const globalShortcutCapabilityFact = (method: GlobalShortcutCapabilityMethod) =>
  NativeSurface.capabilityFact("GlobalShortcut", method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: "GlobalShortcut", methods: [method] })
    ),
    support: GlobalShortcutUnsupportedSupport
  })

const UnsupportedCapabilityFacts = Object.freeze([
  globalShortcutCapabilityFact("register"),
  globalShortcutCapabilityFact("unregister"),
  globalShortcutCapabilityFact("unregisterAll")
])

const GlobalShortcutPressed = NativeSurface.event("GlobalShortcut", "Pressed", {
  payload: GlobalShortcutPressedEvent,
  support: GlobalShortcutUnsupportedSupport
})

const GlobalShortcutRpcGroup = RpcGroup.make(
  GlobalShortcutIsRegistered,
  GlobalShortcutIsSupported,
  GlobalShortcutPressed
)

export const GlobalShortcutRpcs: RpcGroup.RpcGroup<GlobalShortcutRpc> = GlobalShortcutRpcGroup

export const GlobalShortcutMethodNames = Object.freeze([
  "isRegistered",
  "isSupported"
] as const satisfies readonly GlobalShortcutMethodName[])

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
>()("@orika/native/GlobalShortcutClient") {}

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
  "@orika/native/GlobalShortcut"
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

export type GlobalShortcutRpc = RpcGroup.Rpcs<typeof GlobalShortcutRpcGroup>

export type GlobalShortcutRpcHandlers<R = never> = NativeRpcHandlers<
  typeof GlobalShortcutRpcGroup,
  R
>

export const GlobalShortcutHandlersLive = GlobalShortcutRpcGroup.toLayer({
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
    }),
  "GlobalShortcut.events.Pressed": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const shortcuts = yield* GlobalShortcut
        return shortcuts.onPressed()
      })
    )
})

export const GlobalShortcutSurface = NativeSurface.make("GlobalShortcut", GlobalShortcutRpcGroup, {
  service: GlobalShortcutClient,
  handlers: GlobalShortcutHandlersLive,
  capabilityFacts: UnsupportedCapabilityFacts,
  client: (client) => globalShortcutClientFromRpcClient(client),
  bridgeClient: (client, exchange) => globalShortcutBridgeClientFromRpcClient(client, exchange)
})

const globalShortcutClientFromRpcClient = (
  client: DesktopRpcClient<GlobalShortcutRpc>
): GlobalShortcutClientApi => {
  return Object.freeze({
    register: (accelerator, registrarWindow) =>
      decodeGlobalShortcutRegisterInput({
        accelerator,
        registrarWindow: toWindowHandle(registrarWindow)
      }).pipe(
        Effect.flatMap(() =>
          Effect.fail(unsupportedError("GlobalShortcut.register", HostAdapterUnimplementedReason))
        )
      ),
    unregister: (accelerator) =>
      decodeGlobalShortcutAcceleratorInput({ accelerator }).pipe(
        Effect.flatMap(() =>
          Effect.fail(unsupportedError("GlobalShortcut.unregister", HostAdapterUnimplementedReason))
        )
      ),
    unregisterAll: () =>
      Effect.fail(unsupportedError("GlobalShortcut.unregisterAll", HostAdapterUnimplementedReason)),
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
    onPressed: () =>
      runGlobalShortcutRpcStream(
        client["GlobalShortcut.events.Pressed"](undefined),
        "GlobalShortcut.events.Pressed"
      )
  } satisfies GlobalShortcutClientApi)
}

const globalShortcutBridgeClientFromRpcClient = (
  client: DesktopRpcClient<GlobalShortcutRpc>,
  exchange: BridgeClientExchange
): GlobalShortcutClientApi => {
  return Object.freeze({
    register: (accelerator, registrarWindow) =>
      decodeGlobalShortcutRegisterInput({
        accelerator,
        registrarWindow: toWindowHandle(registrarWindow)
      }).pipe(
        Effect.flatMap(() =>
          Effect.fail(unsupportedError("GlobalShortcut.register", HostAdapterUnimplementedReason))
        )
      ),
    unregister: (accelerator) =>
      decodeGlobalShortcutAcceleratorInput({ accelerator }).pipe(
        Effect.flatMap(() =>
          Effect.fail(unsupportedError("GlobalShortcut.unregister", HostAdapterUnimplementedReason))
        )
      ),
    unregisterAll: () =>
      Effect.fail(unsupportedError("GlobalShortcut.unregisterAll", HostAdapterUnimplementedReason)),
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
    onPressed: () => NativeSurface.subscribeEvent(exchange, GlobalShortcutPressed)
  } satisfies GlobalShortcutClientApi)
}

export const makeLinuxGlobalShortcutClient = (
  sessionType = process.env["XDG_SESSION_TYPE"]
): GlobalShortcutClientApi => {
  const support = linuxGlobalShortcutSupport(sessionType)
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, GlobalShortcutError, never> =>
    Effect.fail(unsupportedError(method, HostAdapterUnimplementedReason))
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

const runGlobalShortcutRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  _operation: string
): Stream.Stream<A, GlobalShortcutError, never> =>
  stream.pipe(Stream.mapError(mapGlobalShortcutRpcClientError))

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
