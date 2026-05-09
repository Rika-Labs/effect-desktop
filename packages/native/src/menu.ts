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
  Api,
  Client,
  type ApiClientExchange,
  type ApiClientOptions,
  type ApiContractClass,
  type ApiContractError,
  type ApiContractSpec,
  type ApiHandlers,
  type ApiLayer,
  type ApiResourceHandle,
  ApiResourceHandleShape,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Fiber, Layer, Option, Schema, Stream } from "effect"

import { PrintableNonEmptyString } from "./contracts/strings.js"
import type { WindowHandle } from "./window.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
const WindowResource = Api.Resource("window", "open")
const MenuPlatform = Schema.Literals(["macos", "windows", "linux"])
const MenuCapabilityName = Schema.Literals(["application menu", "window menu", "command binding"])

const MenuItemBase = {
  id: PrintableNonEmptyString,
  label: PrintableNonEmptyString,
  commandId: Schema.optionalKey(PrintableNonEmptyString),
  enabled: Schema.optionalKey(Schema.Boolean),
  checked: Schema.optionalKey(Schema.Boolean),
  accelerator: Schema.optionalKey(PrintableNonEmptyString)
}

export type MenuPlatform = Schema.Schema.Type<typeof MenuPlatform>
export type MenuCapabilityName = Schema.Schema.Type<typeof MenuCapabilityName>
export type MenuWindowHandle = ApiResourceHandle<"window", "open">
export type MenuError = HostProtocolError
export type MenuCommandBindingError = MenuError | CommandRegistryError

export const MenuItem = Schema.Struct({
  type: Schema.Literal("item"),
  ...MenuItemBase
})

export type MenuItem = Schema.Schema.Type<typeof MenuItem>

export const MenuSeparator = Schema.Struct({
  type: Schema.Literal("separator"),
  id: Schema.optionalKey(PrintableNonEmptyString)
})

export type MenuSeparator = Schema.Schema.Type<typeof MenuSeparator>

export interface MenuSubmenuShape {
  readonly type: "submenu"
  readonly id: string
  readonly label: string
  readonly enabled?: boolean
  readonly items: ReadonlyArray<MenuTemplateEntry>
}

export type MenuTemplateEntry = MenuItem | MenuSeparator | MenuSubmenuShape

export const MenuSubmenu: Schema.Schema<MenuSubmenuShape> = Schema.Struct({
  type: Schema.Literal("submenu"),
  id: PrintableNonEmptyString,
  label: PrintableNonEmptyString,
  enabled: Schema.optionalKey(Schema.Boolean),
  items: Schema.Array(Schema.suspend((): Schema.Schema<MenuTemplateEntry> => MenuTemplateEntry))
})

export const MenuTemplateEntry: Schema.Schema<MenuTemplateEntry> = Schema.suspend(() =>
  Schema.Union([MenuItem, MenuSeparator, MenuSubmenu])
)

export class MenuTemplate extends Schema.Class<MenuTemplate>("MenuTemplate")({
  items: Schema.Array(MenuTemplateEntry)
}) {}

export type MenuTemplateOptions = Schema.Schema.Type<typeof MenuTemplate>

export class MenuSetApplicationMenuInput extends Schema.Class<MenuSetApplicationMenuInput>(
  "MenuSetApplicationMenuInput"
)({
  template: MenuTemplate
}) {}

export class MenuSetWindowMenuInput extends Schema.Class<MenuSetWindowMenuInput>(
  "MenuSetWindowMenuInput"
)({
  window: WindowResource.schema,
  template: MenuTemplate
}) {}

export class MenuClearInput extends Schema.Class<MenuClearInput>("MenuClearInput")({
  window: Schema.optionalKey(WindowResource.schema)
}) {}

export type MenuClearOptions = Schema.Schema.Type<typeof MenuClearInput>

export class MenuBindCommandInput extends Schema.Class<MenuBindCommandInput>(
  "MenuBindCommandInput"
)({
  itemId: PrintableNonEmptyString,
  commandId: PrintableNonEmptyString
}) {}

export class MenuCapabilityInput extends Schema.Class<MenuCapabilityInput>("MenuCapabilityInput")({
  name: MenuCapabilityName,
  platform: Schema.optionalKey(MenuPlatform)
}) {}

export type MenuCapabilityOptions = Schema.Schema.Type<typeof MenuCapabilityInput>

export class MenuCapabilityResult extends Schema.Class<MenuCapabilityResult>(
  "MenuCapabilityResult"
)({
  supported: Schema.Boolean
}) {}

export class MenuActivatedEvent extends Schema.Class<MenuActivatedEvent>("MenuActivatedEvent")({
  itemId: PrintableNonEmptyString,
  commandId: PrintableNonEmptyString,
  windowId: Schema.optionalKey(PrintableNonEmptyString)
}) {}

export const MenuApiSpec = Object.freeze({
  setApplicationMenu: menuMethodSpec(
    MenuSetApplicationMenuInput,
    "native.invoke:Menu.setApplicationMenu"
  ),
  setWindowMenu: menuMethodSpec(MenuSetWindowMenuInput, "native.invoke:Menu.setWindowMenu"),
  clear: menuMethodSpec(MenuClearInput, "native.invoke:Menu.clear"),
  bindCommand: menuMethodSpec(MenuBindCommandInput, "native.invoke:Menu.bindCommand"),
  capability: {
    input: MenuCapabilityInput,
    output: MenuCapabilityResult,
    error: HostProtocolErrorSchema,
    permission: "none"
  }
}) satisfies ApiContractSpec

export type MenuApiSpec = typeof MenuApiSpec

export const MenuApiEvents = Object.freeze({
  Activated: { payload: MenuActivatedEvent }
})

export type MenuApiEvents = typeof MenuApiEvents

export const MenuApi: ApiContractClass<"Menu", MenuApiSpec, MenuApiEvents> = (() => {
  const contract = class {
    static readonly tag = "Menu"
    static readonly spec = MenuApiSpec
    static readonly events = MenuApiEvents

    static layer<Handlers extends ApiHandlers<MenuApiSpec>>(
      handlers: Handlers
    ): ApiLayer<"Menu", MenuApiSpec, Handlers, MenuApiEvents> {
      return Object.freeze({
        contract,
        handlers: Object.freeze(handlers)
      })
    }
  } as ApiContractClass<"Menu", MenuApiSpec, MenuApiEvents>

  return Object.freeze(contract)
})()

export const registerMenuApi = (): Effect.Effect<
  ApiContractClass<"Menu", MenuApiSpec, MenuApiEvents>,
  ApiContractError,
  never
> =>
  Effect.gen(function* () {
    const existing = yield* Api.get("Menu")
    if (Option.isSome(existing)) {
      return existing.value as ApiContractClass<"Menu", MenuApiSpec, MenuApiEvents>
    }

    return yield* Api.Tag("Menu")<unknown>()(MenuApiSpec, MenuApiEvents)
  })

export const MenuMethodNames = Object.freeze(
  Object.keys(MenuApiSpec) as ReadonlyArray<keyof MenuApiSpec>
)

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
  exchange: ApiClientExchange,
  options: ApiClientOptions = {}
): Layer.Layer<MenuClient> => Layer.succeed(MenuClient)(makeMenuBridgeClient(exchange, options))

export const makeHostMenuApiLayer = <Handlers extends ApiHandlers<MenuApiSpec>>(
  handlers: Handlers
): ApiLayer<"Menu", MenuApiSpec, Handlers, MenuApiEvents> => MenuApi.layer(handlers)

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
    yield* client.bindCommand(itemId, commandId)

    const fiber = yield* client.onActivated().pipe(
      Stream.filter((event) => event.itemId === itemId && event.commandId === commandId),
      Stream.runForEach((event) =>
        invokeMenuCommand(commands, commandId, event.itemId, event.windowId)
      ),
      Effect.forkDetach
    )
    listener = fiber

    const handle = yield* resources.register({
      kind: "menu-command",
      id: menuCommandResourceId(itemId, commandId),
      ownerScope: "app",
      state: "registered",
      dispose: Fiber.interrupt(fiber).pipe(Effect.asVoid)
    })
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
          error,
          itemId,
          windowId
        })
      )
    )
}

const makeMenuBridgeClient = (
  exchange: ApiClientExchange,
  options: ApiClientOptions
): MenuClientApi => {
  const client = Client({ Menu: MenuApi }, exchange, options).Menu

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
  new ApiResourceHandleShape({
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

function menuMethodSpec<Input extends Schema.Schema<unknown>>(input: Input, permission: string) {
  return {
    input,
    output: Schema.Void,
    error: HostProtocolErrorSchema,
    permission
  } as const
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
