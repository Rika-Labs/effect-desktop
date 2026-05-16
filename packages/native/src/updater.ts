import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  makeDesktopClientProtocol,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  RpcClient,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { type PermissionRegistry, P, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
import { subscribeNativeEvent } from "./event-stream.js"
import {
  UpdaterCheckInput,
  UpdaterCheckResult,
  UpdaterDownloadInput,
  UpdaterInstallInput,
  UpdaterPreparingRestartEvent,
  UpdaterStatusResult
} from "./contracts/updater.js"

export type UpdaterError = HostProtocolError

export type UpdaterCheckOptions = Schema.Schema.Type<typeof UpdaterCheckInput>

export type UpdaterDownloadOptions = Schema.Schema.Type<typeof UpdaterDownloadInput>

export type UpdaterInstallOptions = Schema.Schema.Type<typeof UpdaterInstallInput>

export const UpdaterCheck = updaterRpc(
  "check",
  UpdaterCheckInput,
  UpdaterCheckResult,
  P.nativeInvoke({ primitive: "Updater", methods: ["check"] })
)
export const UpdaterDownload = updaterRpc(
  "download",
  UpdaterDownloadInput,
  UpdaterStatusResult,
  P.nativeInvoke({ primitive: "Updater", methods: ["download"] })
)
export const UpdaterInstall = updaterRpc(
  "install",
  UpdaterInstallInput,
  UpdaterStatusResult,
  P.nativeInvoke({ primitive: "Updater", methods: ["install"] })
)
export const UpdaterInstallAndRestart = updaterRpc(
  "installAndRestart",
  UpdaterInstallInput,
  UpdaterStatusResult,
  P.nativeInvoke({ primitive: "Updater", methods: ["installAndRestart"] })
)
export const UpdaterGetStatus = updaterRpc(
  "getStatus",
  Schema.Void,
  UpdaterStatusResult,
  P.nativeInvoke({ primitive: "Updater", methods: ["getStatus"] })
)
export const UpdaterReadyForRestart = updaterRpc(
  "readyForRestart",
  Schema.Void,
  Schema.Void,
  P.nativeInvoke({ primitive: "Updater", methods: ["readyForRestart"] })
)

export const UpdaterRpcEvents = Object.freeze({
  PreparingRestart: { payload: UpdaterPreparingRestartEvent }
})

export type UpdaterRpcEvents = typeof UpdaterRpcEvents

const UpdaterRpcGroup = RpcGroup.make(
  UpdaterCheck,
  UpdaterDownload,
  UpdaterInstall,
  UpdaterInstallAndRestart,
  UpdaterGetStatus,
  UpdaterReadyForRestart
)

export const UpdaterRpcs: RpcGroup.RpcGroup<UpdaterRpc> = UpdaterRpcGroup

export const UpdaterMethodNames = Object.freeze([
  "check",
  "download",
  "install",
  "installAndRestart",
  "getStatus",
  "readyForRestart"
] as const)

export interface UpdaterClientApi {
  readonly check: (
    options?: UpdaterCheckOptions
  ) => Effect.Effect<UpdaterCheckResult, UpdaterError, never>
  readonly download: (
    options?: UpdaterDownloadOptions
  ) => Effect.Effect<UpdaterStatusResult, UpdaterError, never>
  readonly install: (
    options?: UpdaterInstallOptions
  ) => Effect.Effect<UpdaterStatusResult, UpdaterError, never>
  readonly installAndRestart: (
    options?: UpdaterInstallOptions
  ) => Effect.Effect<UpdaterStatusResult, UpdaterError, never>
  readonly getStatus: () => Effect.Effect<UpdaterStatusResult, UpdaterError, never>
  readonly readyForRestart: () => Effect.Effect<void, UpdaterError, never>
  readonly onPreparingRestart: () => Stream.Stream<
    UpdaterPreparingRestartEvent,
    UpdaterError,
    never
  >
}

export class UpdaterClient extends Context.Service<UpdaterClient, UpdaterClientApi>()(
  "@effect-desktop/native/UpdaterClient"
) {}

export type UpdaterServiceApi = UpdaterClientApi

export class Updater extends Context.Service<Updater, UpdaterServiceApi>()(
  "@effect-desktop/native/Updater"
) {
  static readonly layer = Layer.effect(Updater)(
    Effect.gen(function* () {
      const client = yield* UpdaterClient
      return Updater.of({
        check: (options) => client.check(options),
        download: (options) => client.download(options),
        install: (options) => client.install(options),
        installAndRestart: (options) => client.installAndRestart(options),
        getStatus: () => client.getStatus(),
        readyForRestart: () => client.readyForRestart(),
        onPreparingRestart: () => client.onPreparingRestart()
      } satisfies UpdaterServiceApi)
    })
  )
}

export const UpdaterLive = Updater.layer

export const makeUpdaterClientLayer = (client: UpdaterClientApi): Layer.Layer<UpdaterClient> =>
  Layer.succeed(UpdaterClient)(client)

export const makeUpdaterServiceLayer = (client: UpdaterClientApi): Layer.Layer<Updater> =>
  Layer.provide(UpdaterLive, makeUpdaterClientLayer(client))

export const makeUpdaterBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<UpdaterClient> =>
  Layer.effect(
    UpdaterClient,
    RpcClient.make(UpdaterRpcGroup).pipe(
      Effect.map((client) =>
        updaterClientFromRpcClient(client, () =>
          subscribeUpdaterEvent(exchange, "Updater.PreparingRestart")
        )
      )
    )
  ).pipe(Layer.provide(makeUpdaterBridgeProtocolLayer(exchange, options)))

export type UpdaterRpc = RpcGroup.Rpcs<typeof UpdaterRpcGroup>

export type UpdaterRpcHandlers = RpcGroup.HandlersFrom<UpdaterRpc>

export const UpdaterHandlersLive = UpdaterRpcGroup.toLayer({
  "Updater.check": (input) =>
    Effect.gen(function* () {
      const updater = yield* Updater
      return yield* updater.check(input)
    }),
  "Updater.download": (input) =>
    Effect.gen(function* () {
      const updater = yield* Updater
      return yield* updater.download(input)
    }),
  "Updater.install": (input) =>
    Effect.gen(function* () {
      const updater = yield* Updater
      return yield* updater.install(input)
    }),
  "Updater.installAndRestart": (input) =>
    Effect.gen(function* () {
      const updater = yield* Updater
      return yield* updater.installAndRestart(input)
    }),
  "Updater.getStatus": () =>
    Effect.gen(function* () {
      const updater = yield* Updater
      return yield* updater.getStatus()
    }),
  "Updater.readyForRestart": () =>
    Effect.gen(function* () {
      const updater = yield* Updater
      yield* updater.readyForRestart()
    })
})

export const UpdaterSurface = NativeSurface.make("Updater", UpdaterRpcGroup, {
  service: UpdaterClient,
  capabilities: UpdaterMethodNames,
  handlers: UpdaterHandlersLive,
  client: (client) =>
    updaterClientFromRpcClient(client, () =>
      Stream.fail(
        makeHostProtocolInvalidOutputError(
          "Updater.PreparingRestart",
          "event exchange does not support subscriptions"
        )
      )
    )
})

export const makeHostUpdaterRpcRuntime = (
  handlers: UpdaterRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> => UpdaterSurface.hostRuntime(handlers, runtimeOptions)

const StrictParseOptions = { onExcessProperty: "error" } as const

const updaterClientFromRpcClient = (
  client: DesktopRpcClient<UpdaterRpc>,
  onPreparingRestart: () => Stream.Stream<UpdaterPreparingRestartEvent, UpdaterError, never>
): UpdaterClientApi => {
  return Object.freeze({
    check: (input = {}) =>
      decodeUpdaterCheckInput(input, "Updater.check").pipe(
        Effect.flatMap((decoded) =>
          runUpdaterRpc(client["Updater.check"](decoded), "Updater.check")
        )
      ),
    download: (input = {}) =>
      decodeUpdaterDownloadInput(input, "Updater.download").pipe(
        Effect.flatMap((decoded) =>
          runUpdaterRpc(client["Updater.download"](decoded), "Updater.download")
        )
      ),
    install: (input = {}) =>
      decodeUpdaterInstallInput(input, "Updater.install").pipe(
        Effect.flatMap((decoded) =>
          runUpdaterRpc(client["Updater.install"](decoded), "Updater.install")
        )
      ),
    installAndRestart: (input = {}) =>
      decodeUpdaterInstallInput(input, "Updater.installAndRestart").pipe(
        Effect.flatMap((decoded) =>
          runUpdaterRpc(client["Updater.installAndRestart"](decoded), "Updater.installAndRestart")
        )
      ),
    getStatus: () => runUpdaterRpc(client["Updater.getStatus"](undefined), "Updater.getStatus"),
    readyForRestart: () =>
      runUpdaterRpc(client["Updater.readyForRestart"](undefined), "Updater.readyForRestart"),
    onPreparingRestart
  } satisfies UpdaterClientApi)
}

const makeUpdaterBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const subscribeUpdaterEvent = (
  exchange: BridgeClientExchange,
  method: "Updater.PreparingRestart"
): Stream.Stream<UpdaterPreparingRestartEvent, UpdaterError, never> =>
  subscribeNativeEvent(exchange, method, UpdaterPreparingRestartEvent, StrictParseOptions)

const decodeUpdaterCheckInput = (
  input: unknown,
  operation: string
): Effect.Effect<UpdaterCheckInput, UpdaterError, never> =>
  decodeInput(UpdaterCheckInput, input, operation)

const decodeUpdaterDownloadInput = (
  input: unknown,
  operation: string
): Effect.Effect<UpdaterDownloadInput, UpdaterError, never> =>
  decodeInput(UpdaterDownloadInput, input, operation)

const decodeUpdaterInstallInput = (
  input: unknown,
  operation: string
): Effect.Effect<UpdaterInstallInput, UpdaterError, never> =>
  decodeInput(UpdaterInstallInput, input, operation)

const decodeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, UpdaterError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

function updaterRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc("Updater", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })
}

const runUpdaterRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, UpdaterError, never> =>
  effect.pipe(
    Effect.mapError(mapUpdaterRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapUpdaterRpcClientError = (error: unknown): UpdaterError =>
  isUpdaterError(error)
    ? error
    : makeHostProtocolInternalError("Updater RPC client failed", "Updater")

const isUpdaterError = (error: unknown): error is UpdaterError =>
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
