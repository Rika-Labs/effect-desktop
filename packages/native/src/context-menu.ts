import {
  P,
  type DesktopRpcClient,
  type DesktopRpcCapabilityFact,
  CommandRegistry,
  makeResourceId,
  PermissionActor,
  PermissionContext,
  type CommandRegistryError,
  type PermissionRegistry,
  type ResourceHandle,
  type ResourceId,
  type ResourceRegistry
} from "@orika/core"
import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  RpcGroup,
  type HostProtocolError
} from "@orika/bridge"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
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

const Surface = "ContextMenu"
const EventMethod = "ContextMenu.Activated"

export type ContextMenuError = HostProtocolError
export type ContextMenuCommandBindingError = ContextMenuError | CommandRegistryError

export const ContextMenuShow = NativeSurface.rpc(Surface, "show", {
  payload: ContextMenuShowInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["show"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})

export const ContextMenuCapabilityFacts: readonly DesktopRpcCapabilityFact[] = Object.freeze([])

export const ContextMenuRpcEvents = Object.freeze({
  Activated: { payload: ContextMenuActivatedEvent }
})

export type ContextMenuRpcEvents = typeof ContextMenuRpcEvents

const ContextMenuRpcGroup = RpcGroup.make(ContextMenuShow)

export const ContextMenuRpcs: RpcGroup.RpcGroup<ContextMenuRpc> = ContextMenuRpcGroup

export const ContextMenuMethodNames = Object.freeze(["show"] as const)

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
  "@orika/native/ContextMenuClient"
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
  "@orika/native/ContextMenu"
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
      const contextMenu = yield* ContextMenu
      yield* contextMenu.show(input)
    })
})

export const ContextMenuSurface = NativeSurface.make("ContextMenu", ContextMenuRpcGroup, {
  service: ContextMenuClient,
  handlers: ContextMenuHandlersLive,
  capabilities: ContextMenuMethodNames,
  capabilityFacts: ContextMenuCapabilityFacts,
  client: (client: DesktopRpcClient<ContextMenuRpc>) =>
    contextMenuClientFromRpcClient(client, undefined),
  bridgeClient: (client: DesktopRpcClient<ContextMenuRpc>, exchange: BridgeClientExchange) =>
    contextMenuClientFromRpcClient(client, exchange)
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
          runNativeRpc(client["ContextMenu.show"](decoded), "ContextMenu.show", Surface)
        )
      ),
    buildFromTemplate: (input) =>
      decodeContextMenuBuildFromTemplateInput(input).pipe(Effect.asVoid),
    bindCommand: (itemId, commandId) =>
      decodeContextMenuBindCommandInput({ itemId, commandId }).pipe(Effect.asVoid),
    onActivated: () => subscribeContextMenuEvent(exchange, EventMethod)
  }

  return Object.freeze(contextMenuClient)
}

const subscribeContextMenuEvent = (
  exchange: BridgeClientExchange | undefined,
  method: typeof EventMethod
): Stream.Stream<ContextMenuActivatedEvent, ContextMenuError, never> =>
  subscribeNativeEvent(exchange, method, ContextMenuActivatedEvent)

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
  decodeNativeInput(ContextMenuShowInput, input, "ContextMenu.show")

const decodeContextMenuBuildFromTemplateInput = (
  input: unknown
): Effect.Effect<ContextMenuBuildFromTemplateInput, ContextMenuError, never> =>
  decodeNativeInput(ContextMenuBuildFromTemplateInput, input, "ContextMenu.buildFromTemplate")

const decodeContextMenuBindCommandInput = (
  input: unknown
): Effect.Effect<ContextMenuBindCommandInput, ContextMenuError, never> =>
  decodeNativeInput(ContextMenuBindCommandInput, input, "ContextMenu.bindCommand")
