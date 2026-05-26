import {
  type BridgeClientExchange,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  RpcGroup,
  type HostProtocolError
} from "@orika/bridge"
import { P, type DesktopRpcClient } from "@orika/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
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

const AppSupported = NativeSurface.support.supported
export const AppQuit = NativeSurface.rpc("App", "quit", {
  payload: AppQuitInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "App", methods: ["quit"] })
  ),
  endpoint: "mutation",
  support: AppSupported
})
export const AppExit = NativeSurface.rpc("App", "exit", {
  payload: AppQuitInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "App", methods: ["exit"] })
  ),
  endpoint: "mutation",
  support: AppSupported
})
export const AppRestart = NativeSurface.rpc("App", "restart", {
  payload: AppRestartInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "App", methods: ["restart"] })
  ),
  endpoint: "mutation",
  support: AppSupported
})
export const AppRelaunch = NativeSurface.rpc("App", "relaunch", {
  payload: AppRestartInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "App", methods: ["relaunch"] })
  ),
  endpoint: "mutation",
  support: AppSupported
})
export const AppFocus = NativeSurface.rpc("App", "focus", {
  payload: Schema.Void,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "App", methods: ["focus"] })
  ),
  endpoint: "mutation",
  support: AppSupported
})
export const AppActivate = NativeSurface.rpc("App", "activate", {
  payload: Schema.Void,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "App", methods: ["activate"] })
  ),
  endpoint: "mutation",
  support: AppSupported
})
export const AppRequestSingleInstanceLock = NativeSurface.rpc("App", "requestSingleInstanceLock", {
  payload: Schema.Void,
  success: AppSingleInstanceOutput,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "App", methods: ["requestSingleInstanceLock"] })
  ),
  endpoint: "mutation",
  support: AppSupported
})
export const AppReleaseSingleInstanceLock = NativeSurface.rpc("App", "releaseSingleInstanceLock", {
  payload: Schema.Void,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "App", methods: ["releaseSingleInstanceLock"] })
  ),
  endpoint: "mutation",
  support: AppSupported
})
const AppSecondInstance = NativeSurface.event("App", "onSecondInstance", {
  payload: AppSecondInstanceEvent,
  support: AppSupported
})
const AppOpenFile = NativeSurface.event("App", "onOpenFile", {
  payload: AppOpenFileEvent,
  support: AppSupported
})
const AppOpenUrl = NativeSurface.event("App", "onOpenUrl", {
  payload: AppOpenUrlEvent,
  support: AppSupported
})
const AppBeforeQuit = NativeSurface.event("App", "onBeforeQuit", {
  payload: AppBeforeQuitEvent,
  support: AppSupported
})

const AppRpcGroup = RpcGroup.make(
  AppQuit,
  AppExit,
  AppRestart,
  AppRelaunch,
  AppFocus,
  AppActivate,
  AppRequestSingleInstanceLock,
  AppReleaseSingleInstanceLock,
  AppSecondInstance,
  AppOpenFile,
  AppOpenUrl,
  AppBeforeQuit
)

export const AppRpcs: RpcGroup.RpcGroup<AppRpc> = AppRpcGroup

export const AppMethodNames = Object.freeze([
  "quit",
  "exit",
  "restart",
  "relaunch",
  "focus",
  "activate",
  "requestSingleInstanceLock",
  "releaseSingleInstanceLock"
] as const)

const AppCapabilityMethods = Object.freeze([
  "quit",
  "exit",
  "restart",
  "relaunch",
  "focus",
  "activate",
  "requestSingleInstanceLock",
  "releaseSingleInstanceLock"
] as const satisfies readonly (typeof AppMethodNames)[number][])

export type AppError = HostProtocolError

export interface AppClientApi {
  readonly quit: (input: AppQuitOptions) => Effect.Effect<void, AppError, never>
  readonly exit: (input: AppQuitOptions) => Effect.Effect<void, AppError, never>
  readonly restart: (input: AppRestartOptions) => Effect.Effect<void, AppError, never>
  readonly relaunch: (input: AppRestartOptions) => Effect.Effect<void, AppError, never>
  readonly focus: () => Effect.Effect<void, AppError, never>
  readonly activate: () => Effect.Effect<void, AppError, never>
  readonly requestSingleInstanceLock: () => Effect.Effect<AppSingleInstanceResult, AppError, never>
  readonly releaseSingleInstanceLock: () => Effect.Effect<void, AppError, never>
  readonly onSecondInstance: () => Stream.Stream<AppSecondInstanceEvent, AppError, never>
  readonly onOpenFile: () => Stream.Stream<AppOpenFileEvent, AppError, never>
  readonly onOpenUrl: () => Stream.Stream<AppOpenUrlEvent, AppError, never>
  readonly onBeforeQuit: () => Stream.Stream<AppBeforeQuitEvent, AppError, never>
}

export class AppClient extends Context.Service<AppClient, AppClientApi>()(
  "@orika/native/AppClient"
) {}

export interface AppServiceApi extends Omit<
  AppClientApi,
  "quit" | "exit" | "restart" | "relaunch"
> {
  readonly quit: (input?: AppQuitOptions) => Effect.Effect<void, AppError, never>
  readonly exit: (input?: AppQuitOptions) => Effect.Effect<void, AppError, never>
  readonly restart: (input?: AppRestartOptions) => Effect.Effect<void, AppError, never>
  readonly relaunch: (input?: AppRestartOptions) => Effect.Effect<void, AppError, never>
}

export class App extends Context.Service<App, AppServiceApi>()("@orika/native/App") {
  static readonly layer = Layer.effect(App)(
    Effect.gen(function* () {
      const client = yield* AppClient
      return App.of(makeAppService(client))
    })
  )
}

export type AppRpc = RpcGroup.Rpcs<typeof AppRpcGroup>

export type AppRpcHandlers<R = never> = NativeRpcHandlers<typeof AppRpcGroup, R>

export const AppHandlersLive = AppRpcGroup.toLayer({
  "App.quit": (input) =>
    Effect.gen(function* () {
      const app = yield* App
      yield* app.quit(input)
    }),
  "App.exit": (input) =>
    Effect.gen(function* () {
      const app = yield* App
      yield* app.exit(input)
    }),
  "App.restart": (input) =>
    Effect.gen(function* () {
      const app = yield* App
      yield* app.restart(input)
    }),
  "App.relaunch": (input) =>
    Effect.gen(function* () {
      const app = yield* App
      yield* app.relaunch(input)
    }),
  "App.focus": () =>
    Effect.gen(function* () {
      const app = yield* App
      yield* app.focus()
    }),
  "App.activate": () =>
    Effect.gen(function* () {
      const app = yield* App
      yield* app.activate()
    }),
  "App.requestSingleInstanceLock": () =>
    Effect.gen(function* () {
      const app = yield* App
      return yield* app.requestSingleInstanceLock()
    }),
  "App.releaseSingleInstanceLock": () =>
    Effect.gen(function* () {
      const app = yield* App
      yield* app.releaseSingleInstanceLock()
    }),
  "App.events.onSecondInstance": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const app = yield* App
        return app.onSecondInstance()
      })
    ),
  "App.events.onOpenFile": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const app = yield* App
        return app.onOpenFile()
      })
    ),
  "App.events.onOpenUrl": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const app = yield* App
        return app.onOpenUrl()
      })
    ),
  "App.events.onBeforeQuit": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const app = yield* App
        return app.onBeforeQuit()
      })
    )
})

export const AppSurface = NativeSurface.make("App", AppRpcGroup, {
  service: AppClient,
  capabilities: AppCapabilityMethods,
  handlers: AppHandlersLive,
  client: (client) => appClientFromRpcClient(client),
  bridgeClient: (client, exchange) => appBridgeClientFromRpcClient(client, exchange)
})

const makeAppService = (client: AppClientApi): AppServiceApi => {
  const service: AppServiceApi = {
    quit: (input) => client.quit(input ?? {}),
    exit: (input) => client.exit(input ?? {}),
    restart: (input) => client.restart(input ?? {}),
    relaunch: (input) => client.relaunch(input ?? {}),
    focus: () => client.focus(),
    activate: () => client.activate(),
    requestSingleInstanceLock: () => client.requestSingleInstanceLock(),
    releaseSingleInstanceLock: () => client.releaseSingleInstanceLock(),
    onSecondInstance: () => client.onSecondInstance(),
    onOpenFile: () => client.onOpenFile(),
    onOpenUrl: () => client.onOpenUrl(),
    onBeforeQuit: () => client.onBeforeQuit()
  }

  return Object.freeze(service)
}

const appClientFromRpcClient = (client: DesktopRpcClient<AppRpc>): AppClientApi =>
  Object.freeze({
    quit: (input) =>
      decodeAppQuitInput(input, "App.quit").pipe(
        Effect.flatMap((decoded) => runAppRpc(client["App.quit"](decoded), "App.quit"))
      ),
    exit: (input) =>
      decodeAppQuitInput(input, "App.exit").pipe(
        Effect.flatMap((decoded) => runAppRpc(client["App.exit"](decoded), "App.exit"))
      ),
    restart: (input) =>
      decodeAppRestartInput(input, "App.restart").pipe(
        Effect.flatMap((decoded) => runAppRpc(client["App.restart"](decoded), "App.restart"))
      ),
    relaunch: (input) =>
      decodeAppRestartInput(input, "App.relaunch").pipe(
        Effect.flatMap((decoded) => runAppRpc(client["App.relaunch"](decoded), "App.relaunch"))
      ),
    focus: () => runAppRpc(client["App.focus"](undefined), "App.focus"),
    activate: () => runAppRpc(client["App.activate"](undefined), "App.activate"),
    requestSingleInstanceLock: () =>
      runAppRpc(
        client["App.requestSingleInstanceLock"](undefined),
        "App.requestSingleInstanceLock"
      ),
    releaseSingleInstanceLock: () =>
      runAppRpc(
        client["App.releaseSingleInstanceLock"](undefined),
        "App.releaseSingleInstanceLock"
      ),
    onSecondInstance: () =>
      runAppRpcStream(
        client["App.events.onSecondInstance"](undefined),
        "App.events.onSecondInstance"
      ),
    onOpenFile: () =>
      runAppRpcStream(client["App.events.onOpenFile"](undefined), "App.events.onOpenFile"),
    onOpenUrl: () =>
      runAppRpcStream(client["App.events.onOpenUrl"](undefined), "App.events.onOpenUrl"),
    onBeforeQuit: () =>
      runAppRpcStream(client["App.events.onBeforeQuit"](undefined), "App.events.onBeforeQuit")
  } satisfies AppClientApi)

const appBridgeClientFromRpcClient = (
  client: DesktopRpcClient<AppRpc>,
  exchange: BridgeClientExchange
): AppClientApi =>
  Object.freeze({
    ...appClientFromRpcClient(client),
    onSecondInstance: () =>
      NativeSurface.subscribeEvent(exchange, AppSecondInstance, StrictParseOptions),
    onOpenFile: () => NativeSurface.subscribeEvent(exchange, AppOpenFile, StrictParseOptions),
    onOpenUrl: () => NativeSurface.subscribeEvent(exchange, AppOpenUrl, StrictParseOptions),
    onBeforeQuit: () => NativeSurface.subscribeEvent(exchange, AppBeforeQuit, StrictParseOptions)
  } satisfies AppClientApi)

const decodeAppQuitInput = (
  input: unknown,
  operation: string
): Effect.Effect<AppQuitInput, HostProtocolError, never> =>
  decodeInput(AppQuitInput, input, operation)

const decodeAppRestartInput = (
  input: unknown,
  operation: string
): Effect.Effect<AppRestartInput, HostProtocolError, never> =>
  decodeInput(AppRestartInput, input, operation)

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

const runAppRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  _operation: string
): Stream.Stream<A, AppError, never> => stream.pipe(Stream.mapError(mapAppRpcClientError))

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
