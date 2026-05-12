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
  type BridgeRpcHandlers,
  type BridgeRpcLayer,
  BridgeResourceHandleShape,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  Rpc,
  RpcCapability,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Fiber, Layer, Option, Schema, Stream } from "effect"

export * from "./contracts/menu.js"
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
  "native.invoke:Menu.setApplicationMenu"
)
export const MenuSetWindowMenu = menuRpc(
  "setWindowMenu",
  MenuSetWindowMenuInput,
  Schema.Void,
  "native.invoke:Menu.setWindowMenu"
)
export const MenuClear = menuRpc("clear", MenuClearInput, Schema.Void, "native.invoke:Menu.clear")
export const MenuBindCommand = menuRpc(
  "bindCommand",
  MenuBindCommandInput,
  Schema.Void,
  "native.invoke:Menu.bindCommand"
)
export const MenuCapability = menuRpc(
  "capability",
  MenuCapabilityInput,
  MenuCapabilityResult,
  "none"
)

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

export const MenuRpcs = BridgeRpc.fromGroup("Menu", MenuRpcGroup, MenuRpcEvents)

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
): Layer.Layer<MenuClient> => Layer.succeed(MenuClient)(makeMenuBridgeClient(exchange, options))

export type MenuRpcSpec = (typeof MenuRpcs)["spec"]

export const makeHostMenuBridgeRpcLayer = <Handlers extends BridgeRpcHandlers<MenuRpcSpec>>(
  handlers: Handlers
): BridgeRpcLayer<"Menu", MenuRpcSpec, Handlers, MenuRpcEvents> =>
  BridgeRpc.layer(MenuRpcs)(handlers)

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
  let completed = false
  let listener: Fiber.Fiber<void, MenuError> | undefined

  return Effect.gen(function* () {
    const commands = yield* CommandRegistry
    const resources = yield* ResourceRegistry
    const resourceId = menuCommandResourceId(itemId, commandId)
    const existing = yield* resources.get(resourceId)
    if (Option.isSome(existing)) {
      return existing.value.handle as ResourceHandle<"menu-command", "registered">
    }

    yield* client.bindCommand(itemId, commandId)

    const fiber = yield* client.onActivated().pipe(
      Stream.filter((event) => event.itemId === itemId && event.commandId === commandId),
      Stream.runForEach((event) =>
        invokeMenuCommand(commands, commandId, event.itemId, event.windowId)
      ),
      Effect.forkDetach
    )
    listener = fiber

    const handle = yield* resources
      .register({
        kind: "menu-command",
        id: resourceId,
        ownerScope: "app",
        state: "registered",
        dispose: Fiber.interrupt(fiber).pipe(Effect.asVoid)
      })
      .pipe(Effect.orDie)
    completed = true
    return handle
  }).pipe(
    Effect.ensuring(
      Effect.suspend(() =>
        completed || listener === undefined
          ? Effect.void
          : Fiber.interrupt(listener).pipe(Effect.asVoid)
      )
    )
  )
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

const makeMenuBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): MenuClientApi => {
  const client = Client({ Menu: MenuRpcs }, exchange, options).Menu as unknown as {
    readonly setApplicationMenu: (
      input: MenuSetApplicationMenuInput
    ) => Effect.Effect<void, MenuError, never>
    readonly setWindowMenu: (input: MenuSetWindowMenuInput) => Effect.Effect<void, MenuError, never>
    readonly clear: (input: MenuClearInput) => Effect.Effect<void, MenuError, never>
    readonly bindCommand: (input: MenuBindCommandInput) => Effect.Effect<void, MenuError, never>
    readonly capability: (
      input: MenuCapabilityInput
    ) => Effect.Effect<MenuCapabilityResult, MenuError, never>
    readonly events: {
      readonly Activated: Stream.Stream<MenuActivatedEvent, MenuError, never>
    }
  }

  const menuClient: MenuClientApi = {
    setApplicationMenu: (template) =>
      decodeMenuSetApplicationMenuInput({ template }).pipe(
        Effect.flatMap(validateApplicationMenuRoots),
        Effect.flatMap(client.setApplicationMenu)
      ),
    setWindowMenu: (window, template) =>
      decodeMenuSetWindowMenuInput({ window: toWindowHandle(window), template }).pipe(
        Effect.flatMap(client.setWindowMenu)
      ),
    clear: (input = {}) =>
      decodeMenuClearInput(
        input.window === undefined ? {} : { window: toWindowHandle(input.window as WindowHandle) }
      ).pipe(Effect.flatMap(client.clear)),
    bindCommand: (itemId, commandId) =>
      decodeMenuBindCommandInput({ itemId, commandId }).pipe(Effect.flatMap(client.bindCommand)),
    capability: (input) => decodeMenuCapabilityInput(input).pipe(Effect.flatMap(client.capability)),
    onActivated: () => client.events.Activated
  }

  return Object.freeze(menuClient)
}

export const makeUnsupportedMenuClient = (): MenuClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, MenuError, never> =>
    Effect.fail(unsupportedError(method))
  const unsupportedStream = <A>(method: string): Stream.Stream<A, MenuError, never> =>
    Stream.fail(unsupportedError(method))

  const client: MenuClientApi = {
    setApplicationMenu: () => unsupportedEffect<void>("Menu.setApplicationMenu"),
    setWindowMenu: () => unsupportedEffect<void>("Menu.setWindowMenu"),
    clear: () => unsupportedEffect<void>("Menu.clear"),
    bindCommand: () => unsupportedEffect<void>("Menu.bindCommand"),
    capability: () => Effect.succeed(new MenuCapabilityResult({ supported: false })),
    onActivated: () => unsupportedStream<MenuActivatedEvent>("Menu.Activated")
  }

  return Object.freeze(client)
}

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "host Menu platform adapter is not implemented yet",
    message: `unsupported Menu method: ${method}`,
    operation: method,
    recoverable: false
  })

const menuCommandResourceId = (itemId: string, commandId: string): ResourceId =>
  `menu-command:${itemId}:${commandId}` as ResourceId

const toWindowHandle = (handle: WindowHandle): MenuWindowHandle =>
  new BridgeResourceHandleShape({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  }) as MenuWindowHandle

const decodeMenuSetApplicationMenuInput = (
  input: unknown
): Effect.Effect<MenuSetApplicationMenuInput, MenuError, never> =>
  decodeInput(MenuSetApplicationMenuInput, input, "Menu.setApplicationMenu") as Effect.Effect<
    MenuSetApplicationMenuInput,
    MenuError,
    never
  >

const decodeMenuSetWindowMenuInput = (
  input: unknown
): Effect.Effect<MenuSetWindowMenuInput, MenuError, never> =>
  decodeInput(MenuSetWindowMenuInput, input, "Menu.setWindowMenu") as Effect.Effect<
    MenuSetWindowMenuInput,
    MenuError,
    never
  >

const decodeMenuClearInput = (input: unknown): Effect.Effect<MenuClearInput, MenuError, never> =>
  decodeInput(MenuClearInput, input, "Menu.clear") as Effect.Effect<
    MenuClearInput,
    MenuError,
    never
  >

const decodeMenuBindCommandInput = (
  input: unknown
): Effect.Effect<MenuBindCommandInput, MenuError, never> =>
  decodeInput(MenuBindCommandInput, input, "Menu.bindCommand") as Effect.Effect<
    MenuBindCommandInput,
    MenuError,
    never
  >

const decodeMenuCapabilityInput = (
  input: unknown
): Effect.Effect<MenuCapabilityInput, MenuError, never> =>
  decodeInput(MenuCapabilityInput, input, "Menu.capability") as Effect.Effect<
    MenuCapabilityInput,
    MenuError,
    never
  >

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

const decodeInput = (
  schema: Schema.Schema<unknown>,
  input: unknown,
  operation: string
): Effect.Effect<unknown, MenuError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(schema)(input, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

function menuRpc<Payload extends Schema.Schema<unknown>, Success extends Schema.Schema<unknown>>(
  method: string,
  payload: Payload,
  success: Success,
  capability: string
) {
  return Rpc.make(`Menu.${method}`, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}

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
