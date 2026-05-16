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
import { commandBindingWarningError } from "./command-binding-log.js"
import {
  ContextMenuActivatedEvent,
  ContextMenuBindCommandInput,
  ContextMenuBuildFromTemplateInput,
  type ContextMenuBuildFromTemplateOptions,
  ContextMenuShowInput,
  type ContextMenuShowOptions
} from "./contracts/context-menu.js"
import type { WindowHandle } from "./window.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

export type ContextMenuError = HostProtocolError
export type ContextMenuCommandBindingError = ContextMenuError | CommandRegistryError

export const ContextMenuShow = contextMenuRpc(
  "show",
  ContextMenuShowInput,
  P.nativeInvoke({ primitive: "ContextMenu", methods: ["show"] })
)
export const ContextMenuBuildFromTemplate = contextMenuRpc(
  "buildFromTemplate",
  ContextMenuBuildFromTemplateInput,
  P.nativeInvoke({ primitive: "ContextMenu", methods: ["buildFromTemplate"] })
)
export const ContextMenuBindCommand = contextMenuRpc(
  "bindCommand",
  ContextMenuBindCommandInput,
  P.nativeInvoke({ primitive: "ContextMenu", methods: ["bindCommand"] })
)

export const ContextMenuRpcEvents = Object.freeze({
  Activated: { payload: ContextMenuActivatedEvent }
})

export type ContextMenuRpcEvents = typeof ContextMenuRpcEvents

const ContextMenuRpcGroup = RpcGroup.make(
  ContextMenuShow,
  ContextMenuBuildFromTemplate,
  ContextMenuBindCommand
)

export const ContextMenuRpcs: RpcGroup.RpcGroup<ContextMenuRpc> = ContextMenuRpcGroup

export const ContextMenuMethodNames = Object.freeze([
  "show",
  "buildFromTemplate",
  "bindCommand"
] as const)

export interface ContextMenuClientApi {
  readonly show: (input: ContextMenuShowOptions) => Effect.Effect<void, ContextMenuError, never>
  readonly buildFromTemplate: (
    input: ContextMenuBuildFromTemplateOptions
  ) => Effect.Effect<void, ContextMenuError, never>
  readonly bindCommand: (
    itemId: string,
    commandId: string
  ) => Effect.Effect<void, ContextMenuError, never>
  readonly onActivated: () => Stream.Stream<ContextMenuActivatedEvent, ContextMenuError, never>
}

export class ContextMenuClient extends Context.Service<ContextMenuClient, ContextMenuClientApi>()(
  "@effect-desktop/native/ContextMenuClient"
) {}

export interface ContextMenuServiceApi extends Omit<ContextMenuClientApi, "bindCommand"> {
  readonly bindCommand: (
    itemId: string,
    commandId: string
  ) => Effect.Effect<
    ResourceHandle<"context-menu-command", "registered">,
    ContextMenuCommandBindingError,
    CommandRegistry | ResourceRegistry
  >
}

export class ContextMenu extends Context.Service<ContextMenu, ContextMenuServiceApi>()(
  "@effect-desktop/native/ContextMenu"
) {
  static readonly layer = Layer.effect(ContextMenu)(
    Effect.gen(function* () {
      const client = yield* ContextMenuClient
      return ContextMenu.of({
        show: (input) => client.show(input),
        buildFromTemplate: (input) => client.buildFromTemplate(input),
        bindCommand: (itemId, commandId) => bindContextMenuCommand(client, itemId, commandId),
        onActivated: () => client.onActivated()
      } satisfies ContextMenuServiceApi)
    })
  )
}

export const ContextMenuLive = ContextMenu.layer

const bindContextMenuCommand = (
  client: ContextMenuClientApi,
  itemId: string,
  commandId: string
): Effect.Effect<
  ResourceHandle<"context-menu-command", "registered">,
  ContextMenuCommandBindingError,
  CommandRegistry | ResourceRegistry
> => {
  return Effect.gen(function* () {
    const commands = yield* CommandRegistry
    const resourceId = contextMenuCommandResourceId(itemId, commandId)
    return yield* bindScopedCommand({
      kind: "context-menu-command",
      id: resourceId,
      ownerScope: "app",
      register: client.bindCommand(itemId, commandId),
      events: client
        .onActivated()
        .pipe(Stream.filter((event) => event.itemId === itemId && event.commandId === commandId)),
      invoke: (event) => invokeContextMenuCommand(commands, commandId, event.itemId, event.windowId)
    })
  })
}

const invokeContextMenuCommand = (
  commands: CommandRegistry["Service"],
  commandId: string,
  itemId: string,
  windowId: string
): Effect.Effect<void, never, never> =>
  commands
    .invoke(
      commandId,
      { itemId, windowId },
      new PermissionContext({
        actor: new PermissionActor({ kind: "window", id: windowId }),
        traceId: `context-menu:${windowId}:${itemId}:${commandId}`
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.tapError((error: CommandRegistryError) =>
        Effect.logWarning("ContextMenu command invocation failed", {
          commandId,
          error: commandBindingWarningError(error),
          itemId,
          windowId
        })
      ),
      Effect.ignore
    )

export const makeContextMenuClientLayer = (
  client: ContextMenuClientApi
): Layer.Layer<ContextMenuClient> => Layer.succeed(ContextMenuClient)(client)

export const makeContextMenuServiceLayer = (
  client: ContextMenuClientApi
): Layer.Layer<ContextMenu> => Layer.provide(ContextMenuLive, makeContextMenuClientLayer(client))

export const makeContextMenuBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<ContextMenuClient> => ContextMenuSurface.bridgeClientLayer(exchange, options)

export type ContextMenuRpc = RpcGroup.Rpcs<typeof ContextMenuRpcGroup>

export type ContextMenuRpcHandlers = RpcGroup.HandlersFrom<ContextMenuRpc>

export const ContextMenuHandlersLive = ContextMenuRpcGroup.toLayer({
  "ContextMenu.show": (input) =>
    Effect.gen(function* () {
      const menu = yield* ContextMenu
      yield* menu.show(input)
    }),
  "ContextMenu.buildFromTemplate": (input) =>
    Effect.gen(function* () {
      const menu = yield* ContextMenu
      yield* menu.buildFromTemplate(input)
    }),
  "ContextMenu.bindCommand": () => Effect.fail(unsupportedError("ContextMenu.bindCommand"))
})

export const ContextMenuSurface = NativeSurface.make("ContextMenu", ContextMenuRpcGroup, {
  service: ContextMenuClient,
  capabilities: ContextMenuMethodNames,
  handlers: ContextMenuHandlersLive,
  client: (client) => contextMenuClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => contextMenuClientFromRpcClient(client, exchange)
})

export const makeHostContextMenuRpcRuntime = (
  handlers: ContextMenuRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  ContextMenuSurface.hostRuntime(handlers, runtimeOptions)

const contextMenuClientFromRpcClient = (
  client: DesktopRpcClient<ContextMenuRpc>,
  exchange: BridgeClientExchange | undefined
): ContextMenuClientApi => {
  const contextMenuClient: ContextMenuClientApi = {
    show: (input) =>
      decodeContextMenuShowInput(toContextMenuShowInput(input)).pipe(
        Effect.flatMap((decoded) =>
          runContextMenuRpc(client["ContextMenu.show"](decoded), "ContextMenu.show")
        )
      ),
    buildFromTemplate: (input) =>
      decodeContextMenuBuildFromTemplateInput(input).pipe(
        Effect.flatMap((decoded) =>
          runContextMenuRpc(
            client["ContextMenu.buildFromTemplate"](decoded),
            "ContextMenu.buildFromTemplate"
          )
        )
      ),
    bindCommand: (itemId, commandId) =>
      decodeContextMenuBindCommandInput({ itemId, commandId }).pipe(
        Effect.flatMap((decoded) =>
          runContextMenuRpc(client["ContextMenu.bindCommand"](decoded), "ContextMenu.bindCommand")
        )
      ),
    onActivated: () => subscribeContextMenuEvent(exchange, "ContextMenu.Activated")
  }

  return Object.freeze(contextMenuClient)
}

const subscribeContextMenuEvent = (
  exchange: BridgeClientExchange | undefined,
  method: "ContextMenu.Activated"
): Stream.Stream<ContextMenuActivatedEvent, ContextMenuError, never> =>
  subscribeNativeEvent(exchange, method, ContextMenuActivatedEvent)

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "ContextMenu command binding is available through the ContextMenu service",
    message: `unsupported ContextMenu method: ${method}`,
    operation: method,
    recoverable: false
  })

const contextMenuCommandResourceId = (itemId: string, commandId: string): ResourceId =>
  makeResourceId(`context-menu-command:${itemId}:${commandId}`)

const toContextMenuShowInput = (input: ContextMenuShowOptions): unknown => ({
  window: toWindowHandle(input.window),
  template: input.template,
  position: input.position
})

const toWindowHandle = (handle: WindowHandle): WindowHandle =>
  Object.freeze({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  })

const decodeContextMenuShowInput = (
  input: unknown
): Effect.Effect<ContextMenuShowInput, ContextMenuError, never> =>
  decodeInput(ContextMenuShowInput, input, "ContextMenu.show")

const decodeContextMenuBuildFromTemplateInput = (
  input: unknown
): Effect.Effect<ContextMenuBuildFromTemplateInput, ContextMenuError, never> =>
  decodeInput(ContextMenuBuildFromTemplateInput, input, "ContextMenu.buildFromTemplate")

const decodeContextMenuBindCommandInput = (
  input: unknown
): Effect.Effect<ContextMenuBindCommandInput, ContextMenuError, never> =>
  decodeInput(ContextMenuBindCommandInput, input, "ContextMenu.bindCommand")

const decodeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, ContextMenuError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

function contextMenuRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc("ContextMenu", method, {
    payload,
    success: Schema.Void,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })
}

const runContextMenuRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, ContextMenuError, never> =>
  effect.pipe(
    Effect.mapError(mapContextMenuRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapContextMenuRpcClientError = (error: unknown): ContextMenuError =>
  isContextMenuError(error)
    ? error
    : makeHostProtocolInternalError("ContextMenu RPC client failed", "ContextMenu")

const isContextMenuError = (error: unknown): error is ContextMenuError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
