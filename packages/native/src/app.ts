import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { type PermissionRegistry, P, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
import { subscribeNativeEvent } from "./event-stream.js"
export * from "./contracts/app.js"
import {
  AppBeforeQuitEvent,
  AppOpenFileEvent,
  AppQuitInput,
  type AppQuitOptions,
  AppRestartInput,
  type AppRestartOptions,
  AppSecondInstanceEvent,
  AppSingleInstanceOutput,
  AppSingleInstanceResult,
  AppOpenUrlEvent
} from "./contracts/app.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

const UnsupportedReason = "host-adapter-unimplemented"

const AppUnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})
const AppSupported = NativeSurface.support.supported
export const AppQuit = appRpc(
  "quit",
  AppQuitInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "App", methods: ["quit"] }),
  AppSupported
)
export const AppRestart = appRpc(
  "restart",
  AppRestartInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "App", methods: ["restart"] })
)
export const AppFocus = appRpc(
  "focus",
  Schema.Void,
  Schema.Void,
  P.nativeInvoke({ primitive: "App", methods: ["focus"] }),
  AppSupported
)
export const AppRequestSingleInstanceLock = appRpc(
  "requestSingleInstanceLock",
  Schema.Void,
  AppSingleInstanceOutput,
  P.nativeInvoke({ primitive: "App", methods: ["requestSingleInstanceLock"] })
)
export const AppRpcEvents = Object.freeze({
  onSecondInstance: { payload: AppSecondInstanceEvent },
  onOpenFile: { payload: AppOpenFileEvent },
  onOpenUrl: { payload: AppOpenUrlEvent },
  onBeforeQuit: { payload: AppBeforeQuitEvent }
})

export type AppRpcEvents = typeof AppRpcEvents

const AppRpcGroup = RpcGroup.make(AppQuit, AppRestart, AppFocus, AppRequestSingleInstanceLock)

export const AppRpcs: RpcGroup.RpcGroup<AppRpc> = AppRpcGroup

export const AppMethodNames = Object.freeze([
  "quit",
  "restart",
  "focus",
  "requestSingleInstanceLock"
] as const)

const AppCapabilityMethods = Object.freeze([
  "quit",
  "restart",
  "focus",
  "requestSingleInstanceLock"
] as const satisfies readonly (typeof AppMethodNames)[number][])

export type AppError = HostProtocolError

export interface AppClientApi {
  readonly quit: (input: AppQuitOptions) => Effect.Effect<void, AppError, never>
  readonly restart: (input: AppRestartOptions) => Effect.Effect<void, AppError, never>
  readonly focus: () => Effect.Effect<void, AppError, never>
  readonly requestSingleInstanceLock: () => Effect.Effect<AppSingleInstanceResult, AppError, never>
  readonly onSecondInstance: () => Stream.Stream<AppSecondInstanceEvent, AppError, never>
  readonly onOpenFile: () => Stream.Stream<AppOpenFileEvent, AppError, never>
  readonly onOpenUrl: () => Stream.Stream<AppOpenUrlEvent, AppError, never>
  readonly onBeforeQuit: () => Stream.Stream<AppBeforeQuitEvent, AppError, never>
}

export class AppClient extends Context.Service<AppClient, AppClientApi>()(
  "@effect-desktop/native/AppClient"
) {}

export interface AppServiceApi extends Omit<AppClientApi, "quit" | "restart"> {
  readonly quit: (input?: AppQuitOptions) => Effect.Effect<void, AppError, never>
  readonly restart: (input?: AppRestartOptions) => Effect.Effect<void, AppError, never>
}

export class App extends Context.Service<App, AppServiceApi>()("@effect-desktop/native/App") {
  static readonly layer = Layer.effect(App)(
    Effect.gen(function* () {
      const client = yield* AppClient
      return App.of(makeAppService(client))
    })
  )
}

export const AppLive = App.layer

export const makeAppClientLayer = (client: AppClientApi): Layer.Layer<AppClient> =>
  Layer.succeed(AppClient)(client)

export const makeAppServiceLayer = (client: AppClientApi): Layer.Layer<App> =>
  Layer.provide(AppLive, makeAppClientLayer(client))

export const makeAppBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<AppClient> => AppSurface.bridgeClientLayer(exchange, options)

export type AppRpc = RpcGroup.Rpcs<typeof AppRpcGroup>

export type AppRpcHandlers = RpcGroup.HandlersFrom<AppRpc>

export const AppHandlersLive = AppRpcGroup.toLayer({
  "App.quit": (input) =>
    Effect.gen(function* () {
      const app = yield* App
      yield* app.quit(input)
    }),
  "App.restart": (input) =>
    Effect.gen(function* () {
      const app = yield* App
      yield* app.restart(input)
    }),
  "App.focus": () =>
    Effect.gen(function* () {
      const app = yield* App
      yield* app.focus()
    }),
  "App.requestSingleInstanceLock": () =>
    Effect.gen(function* () {
      const app = yield* App
      return yield* app.requestSingleInstanceLock()
    })
})

export const AppSurface = NativeSurface.make("App", AppRpcGroup, {
  service: AppClient,
  capabilities: AppCapabilityMethods,
  handlers: AppHandlersLive,
  client: (client) => appClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => appClientFromRpcClient(client, exchange)
})

export const makeHostAppRpcRuntime = (
  handlers: AppRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> => AppSurface.hostRuntime(handlers, runtimeOptions)

const makeAppService = (client: AppClientApi): AppServiceApi => {
  const service: AppServiceApi = {
    quit: (input) => client.quit(input ?? {}),
    restart: (input) => client.restart(input ?? {}),
    focus: () => client.focus(),
    requestSingleInstanceLock: () => client.requestSingleInstanceLock(),
    onSecondInstance: () => client.onSecondInstance(),
    onOpenFile: () => client.onOpenFile(),
    onOpenUrl: () => client.onOpenUrl(),
    onBeforeQuit: () => client.onBeforeQuit()
  }

  return Object.freeze(service)
}

const appClientFromRpcClient = (
  client: DesktopRpcClient<AppRpc>,
  exchange: BridgeClientExchange | undefined
): AppClientApi =>
  Object.freeze({
    quit: (input) =>
      decodeAppQuitInput(input).pipe(
        Effect.flatMap((decoded) => runAppRpc(client["App.quit"](decoded), "App.quit"))
      ),
    restart: (input) =>
      decodeAppRestartInput(input).pipe(
        Effect.flatMap((decoded) => runAppRpc(client["App.restart"](decoded), "App.restart"))
      ),
    focus: () => runAppRpc(client["App.focus"](undefined), "App.focus"),
    requestSingleInstanceLock: () =>
      runAppRpc(
        client["App.requestSingleInstanceLock"](undefined),
        "App.requestSingleInstanceLock"
      ),
    onSecondInstance: () =>
      subscribeAppEvent(exchange, "App.onSecondInstance", AppSecondInstanceEvent),
    onOpenFile: () => subscribeAppEvent(exchange, "App.onOpenFile", AppOpenFileEvent),
    onOpenUrl: () => subscribeAppEvent(exchange, "App.onOpenUrl", AppOpenUrlEvent),
    onBeforeQuit: () => subscribeAppEvent(exchange, "App.onBeforeQuit", AppBeforeQuitEvent)
  } satisfies AppClientApi)

const subscribeAppEvent = <A>(
  exchange: BridgeClientExchange | undefined,
  method: "App.onSecondInstance" | "App.onOpenFile" | "App.onOpenUrl" | "App.onBeforeQuit",
  schema: Schema.Codec<A, unknown, never, never>
): Stream.Stream<A, AppError, never> =>
  subscribeNativeEvent(exchange, method, schema, StrictParseOptions)

const decodeAppQuitInput = (
  input: unknown
): Effect.Effect<AppQuitInput, HostProtocolError, never> =>
  decodeInput(AppQuitInput, input, "App.quit")

const decodeAppRestartInput = (
  input: unknown
): Effect.Effect<AppRestartInput, HostProtocolError, never> =>
  decodeInput(AppRestartInput, input, "App.restart")

const decodeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, HostProtocolError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

function appRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(
  method: Method,
  payload: Payload,
  success: Success,
  capability: RpcCapabilityMetadata,
  support = AppUnsupportedSupport
) {
  return NativeSurface.rpc("App", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support
  })
}

const runAppRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, AppError, never> =>
  effect.pipe(
    Effect.mapError(mapAppRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapAppRpcClientError = (error: unknown): AppError =>
  isAppError(error) ? error : makeHostProtocolInternalError("App RPC client failed", "App")

const isAppError = (error: unknown): error is AppError =>
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
