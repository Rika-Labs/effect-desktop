import {
  type DesktopRpcClient,
  CommandRegistry,
  PermissionActor,
  PermissionContext,
  ResourceRegistry,
  type CommandRegistryError,
  type ResourceHandle,
  type ResourceId
} from "@effect-desktop/core"
import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolEventEnvelope,
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
import { Context, Effect, Fiber, Layer, Option, Schema, Stream } from "effect"

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
  "native.invoke:ContextMenu.show"
)
export const ContextMenuBuildFromTemplate = contextMenuRpc(
  "buildFromTemplate",
  ContextMenuBuildFromTemplateInput,
  "native.invoke:ContextMenu.buildFromTemplate"
)
export const ContextMenuBindCommand = contextMenuRpc(
  "bindCommand",
  ContextMenuBindCommandInput,
  "native.invoke:ContextMenu.bindCommand"
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
) {}

export const ContextMenuLive = Layer.effect(ContextMenu)(
  Effect.gen(function* () {
    const client = yield* ContextMenuClient
    return Object.freeze({
      show: (input) => client.show(input),
      buildFromTemplate: (input) => client.buildFromTemplate(input),
      bindCommand: (itemId, commandId) => bindContextMenuCommand(client, itemId, commandId),
      onActivated: () => client.onActivated()
    } satisfies ContextMenuServiceApi)
  })
)

const bindContextMenuCommand = (
  client: ContextMenuClientApi,
  itemId: string,
  commandId: string
): Effect.Effect<
  ResourceHandle<"context-menu-command", "registered">,
  ContextMenuCommandBindingError,
  CommandRegistry | ResourceRegistry
> => {
  let completed = false
  let listener: Fiber.Fiber<void, ContextMenuError> | undefined

  return Effect.gen(function* () {
    const commands = yield* CommandRegistry
    const resources = yield* ResourceRegistry
    const resourceId = contextMenuCommandResourceId(itemId, commandId)
    const existing = yield* resources.get(resourceId)
    if (Option.isSome(existing)) {
      return existing.value.handle as ResourceHandle<"context-menu-command", "registered">
    }

    yield* client.bindCommand(itemId, commandId)

    const fiber = yield* client.onActivated().pipe(
      Stream.filter((event) => event.itemId === itemId && event.commandId === commandId),
      Stream.runForEach((event) =>
        invokeContextMenuCommand(commands, commandId, event.itemId, event.windowId)
      ),
      Effect.forkDetach
    )
    listener = fiber

    const handle = yield* resources
      .register({
        kind: "context-menu-command",
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
      Effect.catch((error: CommandRegistryError) =>
        Effect.logWarning("ContextMenu command invocation failed", {
          commandId,
          error: commandBindingWarningError(error),
          itemId,
          windowId
        })
      )
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
): Layer.Layer<ContextMenuClient> =>
  Layer.succeed(ContextMenuClient)(makeContextMenuBridgeClient(exchange, options))

export type ContextMenuRpc = RpcGroup.Rpcs<typeof ContextMenuRpcGroup>

export type ContextMenuRpcHandlers = Parameters<typeof ContextMenuRpcGroup.toLayer>[0]

export const makeHostContextMenuRpcRuntime = (
  handlers: ContextMenuRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<unknown> =>
  makeDesktopRpcHandlerRuntime(
    ContextMenuRpcGroup,
    ContextMenuRpcGroup.toLayer(handlers),
    runtimeOptions
  )

const makeContextMenuBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): ContextMenuClientApi => {
  const contextMenuClient: ContextMenuClientApi = {
    show: (input) =>
      decodeContextMenuShowInput(toContextMenuShowInput(input)).pipe(
        Effect.flatMap((decoded) =>
          withContextMenuRpcClient(exchange, options, (client) =>
            runContextMenuRpc(client["ContextMenu.show"](decoded), "ContextMenu.show")
          )
        )
      ),
    buildFromTemplate: (input) =>
      decodeContextMenuBuildFromTemplateInput(input).pipe(
        Effect.flatMap((decoded) =>
          withContextMenuRpcClient(exchange, options, (client) =>
            runContextMenuRpc(
              client["ContextMenu.buildFromTemplate"](decoded),
              "ContextMenu.buildFromTemplate"
            )
          )
        )
      ),
    bindCommand: (itemId, commandId) =>
      decodeContextMenuBindCommandInput({ itemId, commandId }).pipe(
        Effect.flatMap((decoded) =>
          withContextMenuRpcClient(exchange, options, (client) =>
            runContextMenuRpc(client["ContextMenu.bindCommand"](decoded), "ContextMenu.bindCommand")
          )
        )
      ),
    onActivated: () => subscribeContextMenuEvent(exchange, "ContextMenu.Activated")
  }

  return Object.freeze(contextMenuClient)
}

const makeContextMenuBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const withContextMenuRpcClient = <A>(
  exchange: BridgeClientExchange,
  options: BridgeClientOptions,
  use: (client: ContextMenuRpcClient) => Effect.Effect<A, ContextMenuError, never>
): Effect.Effect<A, ContextMenuError, never> =>
  Effect.scoped(
    RpcClient.make(ContextMenuRpcGroup).pipe(
      Effect.flatMap(use),
      Effect.provide(makeContextMenuBridgeProtocolLayer(exchange, options))
    )
  )

const subscribeContextMenuEvent = (
  exchange: BridgeClientExchange,
  method: "ContextMenu.Activated"
): Stream.Stream<ContextMenuActivatedEvent, ContextMenuError, never> => {
  if (exchange.subscribe === undefined) {
    return Stream.fail(
      makeHostProtocolInvalidOutputError(method, "event exchange does not support subscriptions")
    )
  }

  return exchange
    .subscribe(method)
    .pipe(Stream.mapEffect((envelope) => decodeContextMenuEventEnvelope(method, envelope)))
}

const decodeContextMenuEventEnvelope = (
  operation: string,
  envelope: HostProtocolEventEnvelope
): Effect.Effect<ContextMenuActivatedEvent, ContextMenuError, never> => {
  if (envelope.method !== operation) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(operation, `unexpected event method: ${envelope.method}`)
    )
  }

  return Effect.mapError(
    Schema.decodeUnknownEffect(ContextMenuActivatedEvent)(envelope.payload) as Effect.Effect<
      ContextMenuActivatedEvent,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  )
}

export const makeUnsupportedContextMenuClient = (): ContextMenuClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, ContextMenuError, never> =>
    Effect.fail(unsupportedError(method))
  const unsupportedStream = <A>(method: string): Stream.Stream<A, ContextMenuError, never> =>
    Stream.fail(unsupportedError(method))

  const client: ContextMenuClientApi = {
    show: () => unsupportedEffect<void>("ContextMenu.show"),
    buildFromTemplate: () => unsupportedEffect<void>("ContextMenu.buildFromTemplate"),
    bindCommand: () => unsupportedEffect<void>("ContextMenu.bindCommand"),
    onActivated: () => unsupportedStream<ContextMenuActivatedEvent>("ContextMenu.Activated")
  }

  return Object.freeze(client)
}

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "host ContextMenu platform adapter is not implemented yet",
    message: `unsupported ContextMenu method: ${method}`,
    operation: method,
    recoverable: false
  })

const contextMenuCommandResourceId = (itemId: string, commandId: string): ResourceId =>
  `context-menu-command:${itemId}:${commandId}` as ResourceId

const toContextMenuShowInput = (input: ContextMenuShowOptions): unknown => ({
  window: toWindowHandle(input.window as WindowHandle),
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
  }) as WindowHandle

const decodeContextMenuShowInput = (
  input: unknown
): Effect.Effect<ContextMenuShowInput, ContextMenuError, never> =>
  decodeInput(ContextMenuShowInput, input, "ContextMenu.show") as Effect.Effect<
    ContextMenuShowInput,
    ContextMenuError,
    never
  >

const decodeContextMenuBuildFromTemplateInput = (
  input: unknown
): Effect.Effect<ContextMenuBuildFromTemplateInput, ContextMenuError, never> =>
  decodeInput(
    ContextMenuBuildFromTemplateInput,
    input,
    "ContextMenu.buildFromTemplate"
  ) as Effect.Effect<ContextMenuBuildFromTemplateInput, ContextMenuError, never>

const decodeContextMenuBindCommandInput = (
  input: unknown
): Effect.Effect<ContextMenuBindCommandInput, ContextMenuError, never> =>
  decodeInput(ContextMenuBindCommandInput, input, "ContextMenu.bindCommand") as Effect.Effect<
    ContextMenuBindCommandInput,
    ContextMenuError,
    never
  >

const decodeInput = (
  schema: Schema.Schema<unknown>,
  input: unknown,
  operation: string
): Effect.Effect<unknown, ContextMenuError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(schema)(input, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

function contextMenuRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, capability: string) {
  return Rpc.make(`ContextMenu.${method}` as const, {
    payload,
    success: Schema.Void,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}

type ContextMenuRpcClient = DesktopRpcClient<ContextMenuRpc>

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
