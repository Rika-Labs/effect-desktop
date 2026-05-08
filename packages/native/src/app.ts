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
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"

const StrictParseOptions = { onExcessProperty: "error" } as const
const NonNegativeInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
// eslint-disable-next-line no-control-regex -- App launch args must reject NUL.
const ArgString = Schema.String.check(Schema.isPattern(/^[^\u0000]*$/))

export class AppInfo extends Schema.Class<AppInfo>("AppInfo")({
  id: Schema.String,
  name: Schema.String,
  version: Schema.String
}) {}

export class AppCommandLine extends Schema.Class<AppCommandLine>("AppCommandLine")({
  argv: Schema.Array(Schema.String),
  cwd: Schema.String
}) {}

export class AppQuitInput extends Schema.Class<AppQuitInput>("AppQuitInput")({
  exitCode: Schema.optionalKey(NonNegativeInteger)
}) {}

export type AppQuitOptions = Schema.Schema.Type<typeof AppQuitInput>

export class AppRestartInput extends Schema.Class<AppRestartInput>("AppRestartInput")({
  args: Schema.optionalKey(Schema.Array(ArgString))
}) {}

export type AppRestartOptions = Schema.Schema.Type<typeof AppRestartInput>

export class AppSingleInstanceResult extends Schema.Class<AppSingleInstanceResult>(
  "AppSingleInstanceResult"
)({
  acquired: Schema.Boolean,
  primaryPid: Schema.optionalKey(NonNegativeInteger)
}) {}

export class AppOpenAtLoginInput extends Schema.Class<AppOpenAtLoginInput>("AppOpenAtLoginInput")({
  enabled: Schema.Boolean,
  args: Schema.optionalKey(Schema.Array(ArgString))
}) {}

export type AppOpenAtLoginOptions = Schema.Schema.Type<typeof AppOpenAtLoginInput>

export class AppProtocolInput extends Schema.Class<AppProtocolInput>("AppProtocolInput")({
  scheme: Schema.String
}) {}

export type AppProtocolOptions = Schema.Schema.Type<typeof AppProtocolInput>

export class AppSecondInstanceEvent extends Schema.Class<AppSecondInstanceEvent>(
  "AppSecondInstanceEvent"
)({
  argv: Schema.Array(Schema.String),
  cwd: Schema.String,
  traceId: Schema.String
}) {}

export class AppOpenFileEvent extends Schema.Class<AppOpenFileEvent>("AppOpenFileEvent")({
  // eslint-disable-next-line no-control-regex
  path: Schema.NonEmptyString.check(Schema.isPattern(/^[^\x00]*$/))
}) {}

export class AppOpenUrlEvent extends Schema.Class<AppOpenUrlEvent>("AppOpenUrlEvent")({
  url: Schema.String
}) {}

export class AppBeforeQuitEvent extends Schema.Class<AppBeforeQuitEvent>("AppBeforeQuitEvent")({
  traceId: Schema.String
}) {}

export const AppApiSpec = Object.freeze({
  getInfo: {
    input: Schema.Void,
    output: AppInfo,
    error: HostProtocolErrorSchema,
    permission: "none"
  },
  getCommandLine: {
    input: Schema.Void,
    output: AppCommandLine,
    error: HostProtocolErrorSchema,
    permission: "none"
  },
  quit: {
    input: AppQuitInput,
    output: Schema.Void,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:App.quit"
  },
  restart: {
    input: AppRestartInput,
    output: Schema.Void,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:App.restart"
  },
  focus: {
    input: Schema.Void,
    output: Schema.Void,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:App.focus"
  },
  requestSingleInstanceLock: {
    input: Schema.Void,
    output: AppSingleInstanceResult,
    error: HostProtocolErrorSchema,
    permission: "none"
  },
  setOpenAtLogin: {
    input: AppOpenAtLoginInput,
    output: Schema.Void,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:App.setOpenAtLogin"
  },
  registerProtocol: {
    input: AppProtocolInput,
    output: Schema.Void,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:App.registerProtocol"
  }
}) satisfies ApiContractSpec

export type AppApiSpec = typeof AppApiSpec

export const AppApiEvents = Object.freeze({
  onSecondInstance: { payload: AppSecondInstanceEvent },
  onOpenFile: { payload: AppOpenFileEvent },
  onOpenUrl: { payload: AppOpenUrlEvent },
  onBeforeQuit: { payload: AppBeforeQuitEvent }
})

export type AppApiEvents = typeof AppApiEvents

export const AppApi: ApiContractClass<"App", AppApiSpec, AppApiEvents> = (() => {
  const contract = class {
    static readonly tag = "App"
    static readonly spec = AppApiSpec
    static readonly events = AppApiEvents

    static layer<Handlers extends ApiHandlers<AppApiSpec>>(
      handlers: Handlers
    ): ApiLayer<"App", AppApiSpec, Handlers, AppApiEvents> {
      return Object.freeze({
        contract,
        handlers: Object.freeze(handlers)
      })
    }
  } as ApiContractClass<"App", AppApiSpec, AppApiEvents>

  return Object.freeze(contract)
})()

export const registerAppApi = (): Effect.Effect<
  ApiContractClass<"App", AppApiSpec, AppApiEvents>,
  ApiContractError,
  never
> =>
  Effect.gen(function* () {
    const existing = yield* Api.get("App")
    if (Option.isSome(existing)) {
      return existing.value as ApiContractClass<"App", AppApiSpec, AppApiEvents>
    }

    return yield* Api.Tag("App")<unknown>()(AppApiSpec, AppApiEvents)
  })

export const AppMethodNames = Object.freeze(
  Object.keys(AppApiSpec) as ReadonlyArray<keyof AppApiSpec>
)

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
  readonly onProtocolUrl: () => Stream.Stream<AppOpenUrlEvent, AppError, never>
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
  exchange: ApiClientExchange,
  options: ApiClientOptions = {}
): Layer.Layer<AppClient> => Layer.succeed(AppClient)(makeAppBridgeClient(exchange, options))

export const makeHostAppApiLayer = <Handlers extends ApiHandlers<AppApiSpec>>(
  handlers: Handlers
): ApiLayer<"App", AppApiSpec, Handlers, AppApiEvents> => AppApi.layer(handlers)

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
    onProtocolUrl: () => client.onOpenUrl(),
    onBeforeQuit: () => client.onBeforeQuit()
  }

  return Object.freeze(service)
}

const makeAppBridgeClient = (
  exchange: ApiClientExchange,
  options: ApiClientOptions
): AppClientApi => {
  const client = Client({ App: AppApi }, exchange, options).App

  const appClient: AppClientApi = {
    getInfo: () => client.getInfo(),
    getCommandLine: () => client.getCommandLine(),
    quit: (input) => decodeAppQuitInput(input).pipe(Effect.flatMap(client.quit)),
    restart: (input) => decodeAppRestartInput(input).pipe(Effect.flatMap(client.restart)),
    focus: () => client.focus(),
    requestSingleInstanceLock: () => client.requestSingleInstanceLock(),
    setOpenAtLogin: (input) =>
      decodeAppOpenAtLoginInput(input).pipe(Effect.flatMap(client.setOpenAtLogin)),
    registerProtocol: (input) =>
      decodeAppProtocolInput(input).pipe(Effect.flatMap(client.registerProtocol)),
    onSecondInstance: () => client.events.onSecondInstance,
    onOpenFile: () => client.events.onOpenFile,
    onOpenUrl: () => client.events.onOpenUrl,
    onBeforeQuit: () => client.events.onBeforeQuit
  }

  return Object.freeze(appClient)
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

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
