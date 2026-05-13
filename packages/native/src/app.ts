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
import type { DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

export * from "./contracts/app.js"
import {
  AppBeforeQuitEvent,
  AppCommandLine,
  AppInfo,
  AppOpenAtLoginInput,
  type AppOpenAtLoginOptions,
  AppOpenFileEvent,
  AppProtocolInput,
  type AppProtocolOptions,
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

export const AppGetInfo = appRpc("getInfo", Schema.Void, AppInfo, "none")
export const AppGetCommandLine = appRpc("getCommandLine", Schema.Void, AppCommandLine, "none")
export const AppQuit = appRpc("quit", AppQuitInput, Schema.Void, "native.invoke:App.quit")
export const AppRestart = appRpc(
  "restart",
  AppRestartInput,
  Schema.Void,
  "native.invoke:App.restart"
)
export const AppFocus = appRpc("focus", Schema.Void, Schema.Void, "native.invoke:App.focus")
export const AppRequestSingleInstanceLock = appRpc(
  "requestSingleInstanceLock",
  Schema.Void,
  AppSingleInstanceOutput,
  "none"
)
export const AppSetOpenAtLogin = appRpc(
  "setOpenAtLogin",
  AppOpenAtLoginInput,
  Schema.Void,
  "native.invoke:App.setOpenAtLogin"
)
export const AppRegisterProtocol = appRpc(
  "registerProtocol",
  AppProtocolInput,
  Schema.Void,
  "native.invoke:App.registerProtocol"
)

export const AppRpcEvents = Object.freeze({
  onSecondInstance: { payload: AppSecondInstanceEvent },
  onOpenFile: { payload: AppOpenFileEvent },
  onOpenUrl: { payload: AppOpenUrlEvent },
  onBeforeQuit: { payload: AppBeforeQuitEvent }
})

export type AppRpcEvents = typeof AppRpcEvents

const AppRpcGroup = RpcGroup.make(
  AppGetInfo,
  AppGetCommandLine,
  AppQuit,
  AppRestart,
  AppFocus,
  AppRequestSingleInstanceLock,
  AppSetOpenAtLogin,
  AppRegisterProtocol
)

export const AppRpcs: RpcGroup.RpcGroup<AppRpc> = AppRpcGroup

export const AppMethodNames = Object.freeze([
  "getInfo",
  "getCommandLine",
  "quit",
  "restart",
  "focus",
  "requestSingleInstanceLock",
  "setOpenAtLogin",
  "registerProtocol"
] as const)

export type AppError = HostProtocolError

export interface AppClientApi {
  readonly getInfo: () => Effect.Effect<AppInfo, AppError, never>
  readonly getCommandLine: () => Effect.Effect<AppCommandLine, AppError, never>
  readonly quit: (input: AppQuitOptions) => Effect.Effect<void, AppError, never>
  readonly restart: (input: AppRestartOptions) => Effect.Effect<void, AppError, never>
  readonly focus: () => Effect.Effect<void, AppError, never>
  readonly requestSingleInstanceLock: () => Effect.Effect<AppSingleInstanceResult, AppError, never>
  readonly setOpenAtLogin: (input: AppOpenAtLoginOptions) => Effect.Effect<void, AppError, never>
  readonly registerProtocol: (input: AppProtocolOptions) => Effect.Effect<void, AppError, never>
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

export class App extends Context.Service<App, AppServiceApi>()("@effect-desktop/native/App") {}

export const AppLive = Layer.effect(App)(
  Effect.gen(function* () {
    const client = yield* AppClient
    return makeAppService(client)
  })
)

export const makeAppClientLayer = (client: AppClientApi): Layer.Layer<AppClient> =>
  Layer.succeed(AppClient)(client)

export const makeAppServiceLayer = (client: AppClientApi): Layer.Layer<App> =>
  Layer.provide(AppLive, makeAppClientLayer(client))

export const makeAppBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<AppClient> => Layer.succeed(AppClient)(makeAppBridgeClient(exchange, options))

export type AppRpc = RpcGroup.Rpcs<typeof AppRpcGroup>

export type AppRpcHandlers = Parameters<typeof AppRpcGroup.toLayer>[0]

export const makeHostAppRpcRuntime = (
  handlers: AppRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<unknown> =>
  makeDesktopRpcHandlerRuntime(AppRpcGroup, AppRpcGroup.toLayer(handlers), runtimeOptions)

const makeAppService = (client: AppClientApi): AppServiceApi => {
  const service: AppServiceApi = {
    getInfo: () => client.getInfo(),
    getCommandLine: () => client.getCommandLine(),
    quit: (input) => client.quit(input ?? {}),
    restart: (input) => client.restart(input ?? {}),
    focus: () => client.focus(),
    requestSingleInstanceLock: () => client.requestSingleInstanceLock(),
    setOpenAtLogin: (input) => client.setOpenAtLogin(input),
    registerProtocol: (input) => client.registerProtocol(input),
    onSecondInstance: () => client.onSecondInstance(),
    onOpenFile: () => client.onOpenFile(),
    onOpenUrl: () => client.onOpenUrl(),
    onBeforeQuit: () => client.onBeforeQuit()
  }

  return Object.freeze(service)
}

const makeAppBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): AppClientApi => {
  const appClient: AppClientApi = {
    getInfo: () =>
      withAppRpcClient(exchange, options, (client) =>
        runAppRpc(client["App.getInfo"](undefined), "App.getInfo")
      ),
    getCommandLine: () =>
      withAppRpcClient(exchange, options, (client) =>
        runAppRpc(client["App.getCommandLine"](undefined), "App.getCommandLine")
      ),
    quit: (input) =>
      decodeAppQuitInput(input).pipe(
        Effect.flatMap((decoded) =>
          withAppRpcClient(exchange, options, (client) =>
            runAppRpc(client["App.quit"](decoded), "App.quit")
          )
        )
      ),
    restart: (input) =>
      decodeAppRestartInput(input).pipe(
        Effect.flatMap((decoded) =>
          withAppRpcClient(exchange, options, (client) =>
            runAppRpc(client["App.restart"](decoded), "App.restart")
          )
        )
      ),
    focus: () =>
      withAppRpcClient(exchange, options, (client) =>
        runAppRpc(client["App.focus"](undefined), "App.focus")
      ),
    requestSingleInstanceLock: () =>
      withAppRpcClient(exchange, options, (client) =>
        runAppRpc(
          client["App.requestSingleInstanceLock"](undefined),
          "App.requestSingleInstanceLock"
        )
      ),
    setOpenAtLogin: (input) =>
      decodeAppOpenAtLoginInput(input).pipe(
        Effect.flatMap((decoded) =>
          withAppRpcClient(exchange, options, (client) =>
            runAppRpc(client["App.setOpenAtLogin"](decoded), "App.setOpenAtLogin")
          )
        )
      ),
    registerProtocol: (input) =>
      decodeAppProtocolInput(input).pipe(
        Effect.flatMap((decoded) =>
          withAppRpcClient(exchange, options, (client) =>
            runAppRpc(client["App.registerProtocol"](decoded), "App.registerProtocol")
          )
        )
      ),
    onSecondInstance: () =>
      subscribeAppEvent(exchange, "App.onSecondInstance", AppSecondInstanceEvent),
    onOpenFile: () => subscribeAppEvent(exchange, "App.onOpenFile", AppOpenFileEvent),
    onOpenUrl: () => subscribeAppEvent(exchange, "App.onOpenUrl", AppOpenUrlEvent),
    onBeforeQuit: () => subscribeAppEvent(exchange, "App.onBeforeQuit", AppBeforeQuitEvent)
  }

  return Object.freeze(appClient)
}

const makeAppBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const withAppRpcClient = <A>(
  exchange: BridgeClientExchange,
  options: BridgeClientOptions,
  use: (client: AppRpcClient) => Effect.Effect<A, AppError, never>
): Effect.Effect<A, AppError, never> =>
  Effect.scoped(
    RpcClient.make(AppRpcGroup).pipe(
      Effect.flatMap(use),
      Effect.provide(makeAppBridgeProtocolLayer(exchange, options))
    )
  )

const subscribeAppEvent = <A>(
  exchange: BridgeClientExchange,
  method: "App.onSecondInstance" | "App.onOpenFile" | "App.onOpenUrl" | "App.onBeforeQuit",
  schema: Schema.Schema<A>
): Stream.Stream<A, AppError, never> => {
  if (exchange.subscribe === undefined) {
    return Stream.fail(
      makeHostProtocolInvalidOutputError(method, "event exchange does not support subscriptions")
    )
  }

  return exchange
    .subscribe(method)
    .pipe(Stream.mapEffect((envelope) => decodeAppEventEnvelope(method, schema, envelope)))
}

const decodeAppEventEnvelope = <A>(
  operation: string,
  schema: Schema.Schema<A>,
  envelope: HostProtocolEventEnvelope
): Effect.Effect<A, AppError, never> => {
  if (envelope.method !== operation) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(operation, `unexpected event method: ${envelope.method}`)
    )
  }

  return Effect.mapError(
    Schema.decodeUnknownEffect(schema)(envelope.payload) as Effect.Effect<A, unknown, never>,
    (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  )
}

export const makeUnsupportedAppClient = (): AppClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, AppError, never> =>
    Effect.fail(unsupportedError(method))
  const unsupportedStream = <A>(method: string): Stream.Stream<A, AppError, never> =>
    Stream.fail(unsupportedError(method))

  const client: AppClientApi = {
    getInfo: () => unsupportedEffect<AppInfo>("App.getInfo"),
    getCommandLine: () => unsupportedEffect<AppCommandLine>("App.getCommandLine"),
    quit: () => unsupportedEffect<void>("App.quit"),
    restart: () => unsupportedEffect<void>("App.restart"),
    focus: () => unsupportedEffect<void>("App.focus"),
    requestSingleInstanceLock: () =>
      unsupportedEffect<AppSingleInstanceResult>("App.requestSingleInstanceLock"),
    setOpenAtLogin: () => unsupportedEffect<void>("App.setOpenAtLogin"),
    registerProtocol: () => unsupportedEffect<void>("App.registerProtocol"),
    onSecondInstance: () => unsupportedStream<AppSecondInstanceEvent>("App.onSecondInstance"),
    onOpenFile: () => unsupportedStream<AppOpenFileEvent>("App.onOpenFile"),
    onOpenUrl: () => unsupportedStream<AppOpenUrlEvent>("App.onOpenUrl"),
    onBeforeQuit: () => unsupportedStream<AppBeforeQuitEvent>("App.onBeforeQuit")
  }

  return Object.freeze(client)
}

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "host App platform adapter is not implemented yet",
    message: `unsupported App method: ${method}`,
    operation: method,
    recoverable: false
  })

const decodeAppQuitInput = (
  input: unknown
): Effect.Effect<AppQuitInput, HostProtocolError, never> =>
  decodeInput(AppQuitInput, input, "App.quit") as Effect.Effect<
    AppQuitInput,
    HostProtocolError,
    never
  >

const decodeAppRestartInput = (
  input: unknown
): Effect.Effect<AppRestartInput, HostProtocolError, never> =>
  decodeInput(AppRestartInput, input, "App.restart") as Effect.Effect<
    AppRestartInput,
    HostProtocolError,
    never
  >

const decodeAppOpenAtLoginInput = (
  input: unknown
): Effect.Effect<AppOpenAtLoginInput, HostProtocolError, never> =>
  decodeInput(AppOpenAtLoginInput, input, "App.setOpenAtLogin") as Effect.Effect<
    AppOpenAtLoginInput,
    HostProtocolError,
    never
  >

const decodeAppProtocolInput = (
  input: unknown
): Effect.Effect<AppProtocolInput, HostProtocolError, never> =>
  decodeInput(AppProtocolInput, input, "App.registerProtocol") as Effect.Effect<
    AppProtocolInput,
    HostProtocolError,
    never
  >

const decodeInput = (
  schema: Schema.Schema<unknown>,
  input: unknown,
  operation: string
): Effect.Effect<unknown, HostProtocolError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(schema)(input, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

function appRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: string) {
  return Rpc.make(`App.${method}` as const, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}

type AppRpcClient = DesktopRpcClient<AppRpc>

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
