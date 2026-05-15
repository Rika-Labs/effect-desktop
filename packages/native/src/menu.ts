import {
  P,
  type DesktopRpcClient,
  CommandRegistry,
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
  type HostProtocolEventEnvelope,
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
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
export * from "./contracts/menu.js"
import { bindScopedCommand } from "./command-binding.js"
import { commandBindingWarningError } from "./command-binding-log.js"
import {
  type MenuCapabilityName,
  type MenuClearOptions,
  MenuCapabilityInput,
  MenuCapabilityResult,
  MenuBindCommandInput,
  type MenuPlatform,
  MenuSetApplicationMenuInput,
  MenuSetWindowMenuInput,
  type MenuTemplateOptions,
  type MenuWindowHandle,
  MenuActivatedEvent,
  MenuClearInput
} from "./contracts/menu.js"
import type { WindowHandle } from "./window.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
export type MenuError = HostProtocolError
export type MenuCommandBindingError = MenuError | CommandRegistryError

export type MenuCapabilityOptions = Schema.Schema.Type<typeof MenuCapabilityInput>

export const MenuSetApplicationMenu = menuRpc(
  "setApplicationMenu",
  MenuSetApplicationMenuInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Menu", methods: ["setApplicationMenu"] })
)
export const MenuSetWindowMenu = menuRpc(
  "setWindowMenu",
  MenuSetWindowMenuInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Menu", methods: ["setWindowMenu"] })
)
export const MenuClear = menuRpc(
  "clear",
  MenuClearInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Menu", methods: ["clear"] })
)
export const MenuBindCommand = menuRpc(
  "bindCommand",
  MenuBindCommandInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Menu", methods: ["bindCommand"] })
)
export const MenuCapability = menuRpc("capability", MenuCapabilityInput, MenuCapabilityResult, {
  kind: "none"
})

export const MenuRpcEvents = Object.freeze({
  Activated: { payload: MenuActivatedEvent }
})

export type MenuRpcEvents = typeof MenuRpcEvents

const MenuRpcGroup = RpcGroup.make(
  MenuSetApplicationMenu,
  MenuSetWindowMenu,
  MenuClear,
  MenuBindCommand,
  MenuCapability
)

export const MenuRpcs: RpcGroup.RpcGroup<MenuRpc> = MenuRpcGroup

export const MenuMethodNames = Object.freeze([
  "setApplicationMenu",
  "setWindowMenu",
  "clear",
  "bindCommand",
  "capability"
] as const)

export interface MenuClientApi {
  readonly setApplicationMenu: (
    template: MenuTemplateOptions
  ) => Effect.Effect<void, MenuError, never>
  readonly setWindowMenu: (
    window: WindowHandle,
    template: MenuTemplateOptions
  ) => Effect.Effect<void, MenuError, never>
  readonly clear: (input?: MenuClearOptions) => Effect.Effect<void, MenuError, never>
  readonly bindCommand: (itemId: string, commandId: string) => Effect.Effect<void, MenuError, never>
  readonly capability: (
    input: MenuCapabilityOptions
  ) => Effect.Effect<MenuCapabilityResult, MenuError, never>
  readonly onActivated: () => Stream.Stream<MenuActivatedEvent, MenuError, never>
}

export class MenuClient extends Context.Service<MenuClient, MenuClientApi>()(
  "@effect-desktop/native/MenuClient"
) {}

export interface MenuServiceApi extends Omit<MenuClientApi, "bindCommand" | "capability"> {
  readonly bindCommand: (
    itemId: string,
    commandId: string
  ) => Effect.Effect<
    ResourceHandle<"menu-command", "registered">,
    MenuCommandBindingError,
    CommandRegistry | ResourceRegistry
  >
  readonly capability: (
    name: MenuCapabilityName,
    options?: { readonly platform?: MenuPlatform }
  ) => Effect.Effect<boolean, MenuError, never>
}

export class Menu extends Context.Service<Menu, MenuServiceApi>()("@effect-desktop/native/Menu") {}

export const MenuLive = Layer.effect(Menu)(
  Effect.gen(function* () {
    const client = yield* MenuClient
    return makeMenuService(client)
  })
)

export const makeMenuClientLayer = (client: MenuClientApi): Layer.Layer<MenuClient> =>
  Layer.succeed(MenuClient)(client)

export const makeMenuServiceLayer = (client: MenuClientApi): Layer.Layer<Menu> =>
  Layer.provide(MenuLive, makeMenuClientLayer(client))

export const makeMenuBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<MenuClient> =>
  Layer.effect(
    MenuClient,
    RpcClient.make(MenuRpcGroup).pipe(
      Effect.map((client) => menuClientFromRpcClient(client, exchange))
    )
  ).pipe(Layer.provide(makeMenuBridgeProtocolLayer(exchange, options)))

export type MenuRpc = RpcGroup.Rpcs<typeof MenuRpcGroup>

export type MenuRpcHandlers = Parameters<typeof MenuRpcGroup.toLayer>[0]

export const MenuHandlersLive = MenuRpcGroup.toLayer({
  "Menu.setApplicationMenu": (input) =>
    Effect.gen(function* () {
      const menu = yield* Menu
      yield* menu.setApplicationMenu(input.template)
    }),
  "Menu.setWindowMenu": (input) =>
    Effect.gen(function* () {
      const menu = yield* Menu
      yield* menu.setWindowMenu(input.window, input.template)
    }),
  "Menu.clear": (input) =>
    Effect.gen(function* () {
      const menu = yield* Menu
      yield* menu.clear(input)
    }),
  "Menu.bindCommand": () => Effect.fail(unsupportedError("Menu.bindCommand")),
  "Menu.capability": (input) =>
    Effect.gen(function* () {
      const menu = yield* Menu
      const supported = yield* menu.capability(input.name, {
        ...(input.platform === undefined ? {} : { platform: input.platform })
      })
      return new MenuCapabilityResult({ supported })
    })
})

export const MenuSurface = NativeSurface.make("Menu", MenuRpcGroup, {
  service: MenuClient,
  handlers: MenuHandlersLive,
  client: (client) => menuClientFromRpcClient(client, undefined)
})

export const makeHostMenuRpcRuntime = (
  handlers: MenuRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> => MenuSurface.hostRuntime(handlers, runtimeOptions)

export const menuCapability = (
  name: MenuCapabilityName,
  platform: MenuPlatform = currentMenuPlatform()
): boolean => MENU_CAPABILITY_MATRIX[platform][name]

const makeMenuService = (client: MenuClientApi): MenuServiceApi => {
  const service: MenuServiceApi = {
    setApplicationMenu: (template) => client.setApplicationMenu(template),
    setWindowMenu: (window, template) => client.setWindowMenu(window, template),
    clear: (input) => client.clear(input ?? {}),
    bindCommand: (itemId, commandId) => bindMenuCommand(client, itemId, commandId),
    capability: (name, options) =>
      client
        .capability({
          name,
          ...(options?.platform === undefined ? {} : { platform: options.platform })
        })
        .pipe(Effect.map((result) => result.supported)),
    onActivated: () => client.onActivated()
  }

  return Object.freeze(service)
}

const bindMenuCommand = (
  client: MenuClientApi,
  itemId: string,
  commandId: string
): Effect.Effect<
  ResourceHandle<"menu-command", "registered">,
  MenuCommandBindingError,
  CommandRegistry | ResourceRegistry
> => {
  return Effect.gen(function* () {
    const commands = yield* CommandRegistry
    const resourceId = menuCommandResourceId(itemId, commandId)
    return yield* bindScopedCommand({
      kind: "menu-command",
      id: resourceId,
      ownerScope: "app",
      register: client.bindCommand(itemId, commandId),
      events: client
        .onActivated()
        .pipe(Stream.filter((event) => event.itemId === itemId && event.commandId === commandId)),
      invoke: (event) => invokeMenuCommand(commands, commandId, event.itemId, event.windowId)
    })
  })
}

const invokeMenuCommand = (
  commands: CommandRegistry["Service"],
  commandId: string,
  itemId: string,
  windowId: string | undefined
): Effect.Effect<void, never, never> => {
  const actor =
    windowId === undefined
      ? new PermissionActor({ kind: "app", id: "application-menu" })
      : new PermissionActor({ kind: "window", id: windowId })

  return commands
    .invoke(
      commandId,
      windowId === undefined ? { itemId } : { itemId, windowId },
      new PermissionContext({
        actor,
        traceId: `menu:${windowId ?? "app"}:${itemId}:${commandId}`
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: CommandRegistryError) =>
        Effect.logWarning("Menu command invocation failed", {
          commandId,
          error: commandBindingWarningError(error),
          itemId,
          windowId
        })
      )
    )
}

const menuClientFromRpcClient = (
  client: DesktopRpcClient<MenuRpc>,
  exchange: BridgeClientExchange | undefined
): MenuClientApi => {
  const menuClient: MenuClientApi = {
    setApplicationMenu: (template) =>
      decodeMenuSetApplicationMenuInput({ template }).pipe(
        Effect.flatMap(validateApplicationMenuRoots),
        Effect.flatMap((decoded) =>
          runMenuRpc(client["Menu.setApplicationMenu"](decoded), "Menu.setApplicationMenu")
        )
      ),
    setWindowMenu: (window, template) =>
      decodeMenuSetWindowMenuInput({ window: toWindowHandle(window), template }).pipe(
        Effect.flatMap((decoded) =>
          runMenuRpc(client["Menu.setWindowMenu"](decoded), "Menu.setWindowMenu")
        )
      ),
    clear: (input = {}) =>
      decodeMenuClearInput(
        input.window === undefined ? {} : { window: toWindowHandle(input.window as WindowHandle) }
      ).pipe(Effect.flatMap((decoded) => runMenuRpc(client["Menu.clear"](decoded), "Menu.clear"))),
    bindCommand: (itemId, commandId) =>
      decodeMenuBindCommandInput({ itemId, commandId }).pipe(
        Effect.flatMap((decoded) =>
          runMenuRpc(client["Menu.bindCommand"](decoded), "Menu.bindCommand")
        )
      ),
    capability: (input) =>
      decodeMenuCapabilityInput(input).pipe(
        Effect.flatMap((decoded) =>
          runMenuRpc(client["Menu.capability"](decoded), "Menu.capability")
        )
      ),
    onActivated: () => subscribeMenuEvent(exchange, "Menu.Activated")
  }

  return Object.freeze(menuClient)
}

const makeMenuBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const subscribeMenuEvent = (
  exchange: BridgeClientExchange | undefined,
  method: "Menu.Activated"
): Stream.Stream<MenuActivatedEvent, MenuError, never> => {
  if (exchange?.subscribe === undefined) {
    return Stream.fail(
      makeHostProtocolInvalidOutputError(method, "event exchange does not support subscriptions")
    )
  }

  return exchange
    .subscribe(method)
    .pipe(Stream.mapEffect((envelope) => decodeMenuEventEnvelope(method, envelope)))
}

const decodeMenuEventEnvelope = (
  operation: string,
  envelope: HostProtocolEventEnvelope
): Effect.Effect<MenuActivatedEvent, MenuError, never> => {
  if (envelope.method !== operation) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(operation, `unexpected event method: ${envelope.method}`)
    )
  }

  return Schema.decodeUnknownEffect(MenuActivatedEvent)(envelope.payload).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )
}

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "Menu command binding is available through the Menu service",
    message: `unsupported Menu method: ${method}`,
    operation: method,
    recoverable: false
  })

const menuCommandResourceId = (itemId: string, commandId: string): ResourceId =>
  `menu-command:${itemId}:${commandId}` as ResourceId

const toWindowHandle = (handle: WindowHandle): MenuWindowHandle =>
  Object.freeze({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  }) as MenuWindowHandle

const decodeMenuSetApplicationMenuInput = (
  input: unknown
): Effect.Effect<MenuSetApplicationMenuInput, MenuError, never> =>
  decodeInput(MenuSetApplicationMenuInput, input, "Menu.setApplicationMenu")

const decodeMenuSetWindowMenuInput = (
  input: unknown
): Effect.Effect<MenuSetWindowMenuInput, MenuError, never> =>
  decodeInput(MenuSetWindowMenuInput, input, "Menu.setWindowMenu")

const decodeMenuClearInput = (input: unknown): Effect.Effect<MenuClearInput, MenuError, never> =>
  decodeInput(MenuClearInput, input, "Menu.clear")

const decodeMenuBindCommandInput = (
  input: unknown
): Effect.Effect<MenuBindCommandInput, MenuError, never> =>
  decodeInput(MenuBindCommandInput, input, "Menu.bindCommand")

const decodeMenuCapabilityInput = (
  input: unknown
): Effect.Effect<MenuCapabilityInput, MenuError, never> =>
  decodeInput(MenuCapabilityInput, input, "Menu.capability")

const validateApplicationMenuRoots = (
  input: MenuSetApplicationMenuInput
): Effect.Effect<MenuSetApplicationMenuInput, MenuError, never> => {
  const nonSubmenu = input.template.items.find((item) => item.type !== "submenu")
  if (nonSubmenu !== undefined) {
    return Effect.fail(
      makeHostProtocolInvalidArgumentError(
        "template.items",
        `application menu root entry must be submenu, got "${nonSubmenu.type}"`,
        "Menu.setApplicationMenu"
      )
    )
  }
  return Effect.succeed(input)
}

const decodeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, MenuError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

function menuRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc("Menu", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })
}

const runMenuRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, MenuError, never> =>
  effect.pipe(
    Effect.mapError(mapMenuRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapMenuRpcClientError = (error: unknown): MenuError =>
  isMenuError(error) ? error : makeHostProtocolInternalError("Menu RPC client failed", "Menu")

const isMenuError = (error: unknown): error is MenuError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const currentMenuPlatform = (): MenuPlatform => {
  if (process.platform === "darwin") {
    return "macos"
  }
  if (process.platform === "win32") {
    return "windows"
  }
  return "linux"
}

const MENU_CAPABILITY_MATRIX: Readonly<
  Record<MenuPlatform, Readonly<Record<MenuCapabilityName, boolean>>>
> = Object.freeze({
  macos: Object.freeze({
    "application menu": true,
    "window menu": true,
    "command binding": true
  }),
  windows: Object.freeze({
    "application menu": false,
    "window menu": true,
    "command binding": true
  }),
  linux: Object.freeze({
    "application menu": false,
    "window menu": true,
    "command binding": true
  })
})

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
