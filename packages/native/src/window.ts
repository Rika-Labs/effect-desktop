import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostWindowClientOptions,
  type HostWindowExchange,
  HostProtocolError as HostProtocolErrorSchema,
  makeDesktopClientProtocol,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolNotFoundError,
  makeHostWindowClient,
  makeStaleHandleError,
  Rpc,
  RpcClient,
  RpcCapability,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import {
  DesktopRpc,
  P,
  PermissionRegistry,
  ResourceRegistry,
  type DesktopRpcClient,
  type ResourceId
} from "@effect-desktop/core"
import { Context, Effect, Layer, Option, Schema } from "effect"

import { makeNativeHostRpcRuntime } from "./native-rpc-runtime.js"
import { type AppEventRouterApi, windowScope } from "./app-events.js"
export * from "./contracts/window.js"
import {
  WindowCreateInput,
  type WindowCreateOptions,
  type WindowHandle,
  WindowHandleInput,
  WindowResource
} from "./contracts/window.js"
const StrictParseOptions = { onExcessProperty: "error" } as const
export type WindowError = HostProtocolError

export const WindowCreate = windowRpc(
  "create",
  WindowCreateInput,
  WindowResource,
  P.nativeInvoke({ primitive: "Window", methods: ["create"] })
)
export const WindowClose = windowRpc(
  "close",
  WindowHandleInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Window", methods: ["close"] })
)

const makeWindowRpcGroup = () => RpcGroup.make(WindowCreate, WindowClose)

const WindowRpcGroup = makeWindowRpcGroup()

type WindowRpcUnion = RpcGroup.Rpcs<typeof WindowRpcGroup>

export const WindowRpcs: RpcGroup.RpcGroup<WindowRpcUnion> = WindowRpcGroup

export type WindowSupportedRpc = WindowRpcUnion

export const WindowSupportedRpcs: RpcGroup.RpcGroup<WindowSupportedRpc> = WindowRpcs

export type WindowBridgeClientOptions = Omit<BridgeClientOptions, "nextRequestId">

type WindowRpcClient = DesktopRpcClient<WindowSupportedRpc>

export const WindowMethodNames = Object.freeze(["create", "close"] as const)

export interface WindowClientApi {
  readonly create: (input: WindowCreateOptions) => Effect.Effect<WindowHandle, WindowError, never>
  readonly close: (window: WindowHandle) => Effect.Effect<void, WindowError, never>
}

export class WindowClient extends Context.Service<WindowClient, WindowClientApi>()(
  "@effect-desktop/native/WindowClient"
) {}

export interface WindowServiceApi extends Omit<WindowClientApi, "create"> {
  readonly create: (input?: WindowCreateOptions) => Effect.Effect<WindowHandle, WindowError, never>
}

export class Window extends Context.Service<Window, WindowServiceApi>()(
  "@effect-desktop/native/Window"
) {}

export const WindowLive = Layer.effect(Window)(
  Effect.gen(function* () {
    const client = yield* WindowClient
    return makeWindowService(client)
  })
)

export const makeWindowClientLayer = (client: WindowClientApi): Layer.Layer<WindowClient> =>
  Layer.succeed(WindowClient)(client)

export const makeWindowServiceLayer = (client: WindowClientApi): Layer.Layer<Window> =>
  Layer.provide(WindowLive, makeWindowClientLayer(client))

export const makeWindowBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: WindowBridgeClientOptions = {}
): Layer.Layer<WindowClient> =>
  Layer.effect(WindowClient)(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(WindowSupportedRpcs)
      return windowClientFromRpcClient(client)
    })
  ).pipe(Layer.provide(makeWindowBridgeProtocolLayer(exchange, options)))

export type WindowRpcHandlers = ReturnType<typeof makeHostWindowHandlers>

export const WindowHandlersLive = WindowRpcGroup.toLayer({
  "Window.create": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      return yield* window.create(input)
    }),
  "Window.close": (input) =>
    Effect.gen(function* () {
      const window = yield* Window
      yield* window.close(input.window)
    })
})

export const WindowSurface = DesktopRpc.surface("Window", WindowRpcGroup, {
  service: WindowClient,
  handlers: WindowHandlersLive,
  client: windowClientFromRpcClient
})

export const makeHostWindowRpcRuntime = (
  exchange: HostWindowExchange,
  options: HostWindowRpcOptions = {},
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<ResourceRegistry | PermissionRegistry> =>
  makeNativeHostRpcRuntime(
    WindowRpcGroup,
    WindowRpcGroup.toLayer(makeHostWindowHandlers(exchange, options)),
    runtimeOptions
  )

export interface HostWindowRpcOptions extends HostWindowClientOptions {
  readonly appEventRouter?: AppEventRouterApi
}

export interface WindowSize {
  readonly width: number
  readonly height: number
}

export interface WindowPosition {
  readonly x: number
  readonly y: number
}

const makeWindowService = (client: WindowClientApi): WindowServiceApi => {
  const service: WindowServiceApi = {
    create: (input) => client.create(input ?? {}),
    close: (window) => client.close(window)
  }

  return Object.freeze(service)
}

const makeWindowBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: WindowBridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

function windowClientFromRpcClient(client: WindowRpcClient): WindowClientApi {
  return Object.freeze({
    create: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(WindowCreateInput)(
          input,
          StrictParseOptions
        ).pipe(
          Effect.mapError((error) =>
            makeHostProtocolInvalidArgumentError(
              "payload",
              formatUnknownError(error),
              "Window.create"
            )
          )
        )
        const window = yield* runWindowRpc(client["Window.create"](decoded), "Window.create")
        return yield* decodeWindowHandle(window, "Window.create")
      }),
    close: (window) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(WindowHandleInput)(
          { window },
          StrictParseOptions
        ).pipe(
          Effect.mapError((error) =>
            makeHostProtocolInvalidArgumentError(
              "payload",
              formatUnknownError(error),
              "Window.close"
            )
          )
        )
        yield* runWindowRpc(client["Window.close"](decoded), "Window.close")
      })
  } satisfies WindowClientApi)
}

const decodeWindowHandle = (
  input: unknown,
  operation: string
): Effect.Effect<WindowHandle, WindowError, never> =>
  Schema.decodeUnknownEffect(WindowResource)(input, StrictParseOptions).pipe(
    Effect.map((handle) => handle as WindowHandle),
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )

const runWindowRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, WindowError, never> =>
  effect.pipe(
    Effect.mapError(mapWindowRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapWindowRpcClientError = (error: unknown): WindowError =>
  isWindowError(error) ? error : makeHostProtocolInternalError("Window RPC client failed", "Window")

const isWindowError = (error: unknown): error is WindowError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const makeHostWindowHandlers = (exchange: HostWindowExchange, options: HostWindowRpcOptions) => {
  const host = makeHostWindowClient(exchange, options)
  const knownWindowIds = new Set<string>()

  return {
    "Window.create": (input: WindowCreateInput) =>
      Effect.gen(function* () {
        const registry = yield* ResourceRegistry
        const created = yield* host.create(toHostWindowCreateInput(input))
        knownWindowIds.add(created.windowId)
        const ownerScope = windowScope(created.windowId)
        yield* registry.declareScope(ownerScope, "app").pipe(Effect.orDie)
        const handle = yield* registry
          .register({
            kind: "window",
            id: created.windowId as ResourceId,
            ownerScope,
            state: "open"
          })
          .pipe(Effect.orDie)
        const window = toWindowHandle(handle)
        if (options.appEventRouter !== undefined) {
          yield* options.appEventRouter.windowOpened(window)
        }
        return window
      }),
    "Window.close": (input: WindowHandleInput) =>
      Effect.gen(function* () {
        const registry = yield* ResourceRegistry
        const { window } = input
        const resourceId = window.id
        if (!knownWindowIds.has(window.id)) {
          return yield* Effect.fail(
            makeHostProtocolNotFoundError(`Window:${window.id}`, "Window.close")
          )
        }

        const existing = yield* registry.get(resourceId)
        if (Option.isNone(existing)) {
          return yield* Effect.fail(
            makeStaleHandleError("Window.close", window, window.generation + 1)
          )
        }

        yield* registry
          .assertFresh({
            kind: window.kind,
            generation: window.generation,
            ownerScope: window.ownerScope,
            state: window.state,
            id: resourceId
          })
          .pipe(
            Effect.mapError((error) =>
              makeStaleHandleError("Window.close", window, error.actualGeneration)
            )
          )
        yield* host.destroy(window.id)
        if (options.appEventRouter !== undefined) {
          yield* options.appEventRouter.windowClosed(window.id)
        }
        yield* registry.closeScope(window.ownerScope)
      })
  }
}

const toHostWindowCreateInput = (input: WindowCreateOptions): WindowCreateOptions => {
  return {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.width === undefined ? {} : { width: input.width }),
    ...(input.height === undefined ? {} : { height: input.height }),
    ...(input.titleBarStyle === undefined ? {} : { titleBarStyle: input.titleBarStyle }),
    ...(input.vibrancy === undefined ? {} : { vibrancy: input.vibrancy }),
    ...(input.trafficLights === undefined ? {} : { trafficLights: input.trafficLights })
  }
}

const toWindowHandle = (handle: WindowHandle): WindowHandle =>
  Object.freeze({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  }) as WindowHandle

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

type WindowRpcSuccess = Schema.Codec<unknown, unknown, never, never>

function windowRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends WindowRpcSuccess
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return Rpc.make(`Window.${method}` as const, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability(capability))
}
