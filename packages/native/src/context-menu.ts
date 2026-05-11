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

export const ContextMenuApiSpec = Object.freeze({
  show: contextMenuMethodSpec(ContextMenuShowInput, "native.invoke:ContextMenu.show"),
  buildFromTemplate: contextMenuMethodSpec(
    ContextMenuBuildFromTemplateInput,
    "native.invoke:ContextMenu.buildFromTemplate"
  ),
  bindCommand: contextMenuMethodSpec(
    ContextMenuBindCommandInput,
    "native.invoke:ContextMenu.bindCommand"
  )
}) satisfies ApiContractSpec

export type ContextMenuApiSpec = typeof ContextMenuApiSpec

export const ContextMenuApiEvents = Object.freeze({
  Activated: { payload: ContextMenuActivatedEvent }
})

export type ContextMenuApiEvents = typeof ContextMenuApiEvents

export const ContextMenuApi: ApiContractClass<
  "ContextMenu",
  ContextMenuApiSpec,
  ContextMenuApiEvents
> = (() => {
  const contract = class {
    static readonly tag = "ContextMenu"
    static readonly spec = ContextMenuApiSpec
    static readonly events = ContextMenuApiEvents

    static layer<Handlers extends ApiHandlers<ContextMenuApiSpec>>(
      handlers: Handlers
    ): ApiLayer<"ContextMenu", ContextMenuApiSpec, Handlers, ContextMenuApiEvents> {
      return Object.freeze({
        contract,
        handlers: Object.freeze(handlers)
      })
    }
  } as ApiContractClass<"ContextMenu", ContextMenuApiSpec, ContextMenuApiEvents>

  return Object.freeze(contract)
})()

export const registerContextMenuApi = (): Effect.Effect<
  ApiContractClass<"ContextMenu", ContextMenuApiSpec, ContextMenuApiEvents>,
  ApiContractError,
  never
> =>
  Effect.gen(function* () {
    const existing = yield* Api.get("ContextMenu")
    if (Option.isSome(existing)) {
      return existing.value as ApiContractClass<
        "ContextMenu",
        ContextMenuApiSpec,
        ContextMenuApiEvents
      >
    }

    return yield* Api.Tag("ContextMenu")<unknown>()(ContextMenuApiSpec, ContextMenuApiEvents)
  })

export const ContextMenuMethodNames = Object.freeze(
  Object.keys(ContextMenuApiSpec) as ReadonlyArray<keyof ContextMenuApiSpec>
)

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
        id: contextMenuCommandResourceId(itemId, commandId),
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
          error,
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
  exchange: ApiClientExchange,
  options: ApiClientOptions = {}
): Layer.Layer<ContextMenuClient> =>
  Layer.succeed(ContextMenuClient)(makeContextMenuBridgeClient(exchange, options))

export const makeHostContextMenuApiLayer = <Handlers extends ApiHandlers<ContextMenuApiSpec>>(
  handlers: Handlers
): ApiLayer<"ContextMenu", ContextMenuApiSpec, Handlers, ContextMenuApiEvents> =>
  ContextMenuApi.layer(handlers)

const makeContextMenuBridgeClient = (
  exchange: ApiClientExchange,
  options: ApiClientOptions
): ContextMenuClientApi => {
  const client = Client({ ContextMenu: ContextMenuApi }, exchange, options).ContextMenu

  const contextMenuClient: ContextMenuClientApi = {
    show: (input) =>
      decodeContextMenuShowInput(toContextMenuShowInput(input)).pipe(Effect.flatMap(client.show)),
    buildFromTemplate: (input) =>
      decodeContextMenuBuildFromTemplateInput(input).pipe(Effect.flatMap(client.buildFromTemplate)),
    bindCommand: (itemId, commandId) =>
      decodeContextMenuBindCommandInput({ itemId, commandId }).pipe(
        Effect.flatMap(client.bindCommand)
      ),
    onActivated: () => client.events.Activated
  }

  return Object.freeze(contextMenuClient)
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

const toWindowHandle = (handle: WindowHandle): ApiResourceHandle<"window", "open"> =>
  new ApiResourceHandleShape({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  }) as ApiResourceHandle<"window", "open">

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

function contextMenuMethodSpec<Input extends Schema.Schema<unknown>>(
  input: Input,
  permission: string
) {
  return {
    input,
    output: Schema.Void,
    error: HostProtocolErrorSchema,
    permission
  } as const
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
