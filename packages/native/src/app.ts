import {
  type BridgeClientExchange,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { P, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { subscribeNativeEvent } from "./event-stream.js"
import { NativeSurface } from "./native-surface.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
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

export const AppGetInfo = appRpc("getInfo", Schema.Void, AppInfo, { kind: "none" })
export const AppGetCommandLine = appRpc("getCommandLine", Schema.Void, AppCommandLine, {
  kind: "none"
})
export const AppQuit = appRpc(
  "quit",
  AppQuitInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "App", methods: ["quit"] })
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
  P.nativeInvoke({ primitive: "App", methods: ["focus"] })
)
export const AppRequestSingleInstanceLock = appRpc(
  "requestSingleInstanceLock",
  Schema.Void,
  AppSingleInstanceOutput,
  { kind: "none" }
)
export const AppSetOpenAtLogin = appRpc(
  "setOpenAtLogin",
  AppOpenAtLoginInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "App", methods: ["setOpenAtLogin"] })
)
export const AppRegisterProtocol = appRpc(
  "registerProtocol",
  AppProtocolInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "App", methods: ["registerProtocol"] })
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

const AppCapabilityMethods = Object.freeze([
  "quit",
  "restart",
  "focus",
  "setOpenAtLogin",
  "registerProtocol"
] as const satisfies readonly (typeof AppMethodNames)[number][])

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

export type AppRpc = RpcGroup.Rpcs<typeof AppRpcGroup>

export type AppRpcHandlers = RpcGroup.HandlersFrom<AppRpc>

export const AppHandlersLive = AppRpcGroup.toLayer({
  "App.getInfo": () =>
    Effect.gen(function* () {
      const app = yield* App
      return yield* app.getInfo()
    }),
  "App.getCommandLine": () =>
    Effect.gen(function* () {
      const app = yield* App
      return yield* app.getCommandLine()
    }),
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
    }),
  "App.setOpenAtLogin": (input) =>
    Effect.gen(function* () {
      const app = yield* App
      yield* app.setOpenAtLogin(input)
    }),
  "App.registerProtocol": (input) =>
    Effect.gen(function* () {
      const app = yield* App
      yield* app.registerProtocol(input)
    })
})

export const AppSurface = NativeSurface.make("App", AppRpcGroup, {
  service: AppClient,
  capabilities: AppCapabilityMethods,
  handlers: AppHandlersLive,
  bridgeClient: (client, exchange) => appClientFromRpcClient(client, exchange),
  client: (client) => appClientFromRpcClient(client, undefined)
})

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

const appClientFromRpcClient = (
  client: DesktopRpcClient<AppRpc>,
  exchange: BridgeClientExchange | undefined
): AppClientApi => {
  const appClient: AppClientApi = {
    getInfo: () => runAppRpc(client["App.getInfo"](undefined), "App.getInfo"),
    getCommandLine: () => runAppRpc(client["App.getCommandLine"](undefined), "App.getCommandLine"),
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
    setOpenAtLogin: (input) =>
      decodeAppOpenAtLoginInput(input).pipe(
        Effect.flatMap((decoded) =>
          runAppRpc(client["App.setOpenAtLogin"](decoded), "App.setOpenAtLogin")
        )
      ),
    registerProtocol: (input) =>
      decodeAppProtocolInput(input).pipe(
        Effect.flatMap((decoded) =>
          runAppRpc(client["App.registerProtocol"](decoded), "App.registerProtocol")
        )
      ),
    onSecondInstance: () =>
      subscribeNativeEvent(exchange, "App.onSecondInstance", AppSecondInstanceEvent),
    onOpenFile: () => subscribeNativeEvent(exchange, "App.onOpenFile", AppOpenFileEvent),
    onOpenUrl: () => subscribeNativeEvent(exchange, "App.onOpenUrl", AppOpenUrlEvent),
    onBeforeQuit: () => subscribeNativeEvent(exchange, "App.onBeforeQuit", AppBeforeQuitEvent)
  }

  return Object.freeze(appClient)
}

const decodeAppQuitInput = (
  input: unknown
): Effect.Effect<AppQuitInput, HostProtocolError, never> =>
  decodeNativeInput(AppQuitInput, input, "App.quit")

const decodeAppRestartInput = (
  input: unknown
): Effect.Effect<AppRestartInput, HostProtocolError, never> =>
  decodeNativeInput(AppRestartInput, input, "App.restart")

const decodeAppOpenAtLoginInput = (
  input: unknown
): Effect.Effect<AppOpenAtLoginInput, HostProtocolError, never> =>
  decodeNativeInput(AppOpenAtLoginInput, input, "App.setOpenAtLogin")

const decodeAppProtocolInput = (
  input: unknown
): Effect.Effect<AppProtocolInput, HostProtocolError, never> =>
  decodeNativeInput(AppProtocolInput, input, "App.registerProtocol")

function appRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc("App", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })
}

const runAppRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, AppError, never> => runNativeRpc(effect, operation, "App")
