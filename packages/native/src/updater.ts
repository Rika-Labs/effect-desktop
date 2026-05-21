import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  RpcGroup,
  type HostProtocolError
} from "@orika/bridge"
import { type PermissionRegistry, P, type DesktopRpcClient } from "@orika/core"
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

const DownloadPartialSupportReason = "signed-manifest-file-artifact-only"
const InstallPartialSupportReason = "signed-manifest-staged-install-only"
const RestartPartialSupportReason = "signed-manifest-restart-handshake-only"

const UpdaterDownloadSupport = NativeSurface.support.partial(DownloadPartialSupportReason, {
  platforms: [
    { platform: "macos", status: "partial", reason: DownloadPartialSupportReason },
    { platform: "windows", status: "partial", reason: DownloadPartialSupportReason },
    { platform: "linux", status: "partial", reason: DownloadPartialSupportReason }
  ]
})

const UpdaterInstallSupport = NativeSurface.support.partial(InstallPartialSupportReason, {
  platforms: [
    { platform: "macos", status: "partial", reason: InstallPartialSupportReason },
    { platform: "windows", status: "partial", reason: InstallPartialSupportReason },
    { platform: "linux", status: "partial", reason: InstallPartialSupportReason }
  ]
})

const UpdaterRestartSupport = NativeSurface.support.partial(RestartPartialSupportReason, {
  platforms: [
    { platform: "macos", status: "partial", reason: RestartPartialSupportReason },
    { platform: "windows", status: "partial", reason: RestartPartialSupportReason },
    { platform: "linux", status: "partial", reason: RestartPartialSupportReason }
  ]
})

export type UpdaterCheckOptions = Schema.Schema.Type<typeof UpdaterCheckInput>

export type UpdaterDownloadOptions = Schema.Schema.Type<typeof UpdaterDownloadInput>

export type UpdaterInstallOptions = Schema.Schema.Type<typeof UpdaterInstallInput>

export const UpdaterCheck = NativeSurface.rpc("Updater", "check", {
  payload: UpdaterCheckInput,
  success: UpdaterCheckResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Updater", methods: ["check"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const UpdaterDownload = NativeSurface.rpc("Updater", "download", {
  payload: UpdaterDownloadInput,
  success: UpdaterStatusResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Updater", methods: ["download"] })
  ),
  endpoint: "mutation",
  support: UpdaterDownloadSupport
})
export const UpdaterInstall = NativeSurface.rpc("Updater", "install", {
  payload: UpdaterInstallInput,
  success: UpdaterStatusResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Updater", methods: ["install"] })
  ),
  endpoint: "mutation",
  support: UpdaterInstallSupport
})
export const UpdaterInstallAndRestart = NativeSurface.rpc("Updater", "installAndRestart", {
  payload: UpdaterInstallInput,
  success: UpdaterStatusResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Updater", methods: ["installAndRestart"] })
  ),
  endpoint: "mutation",
  support: UpdaterRestartSupport
})
export const UpdaterGetStatus = NativeSurface.rpc("Updater", "getStatus", {
  payload: Schema.Void,
  success: UpdaterStatusResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Updater", methods: ["getStatus"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})
export const UpdaterReadyForRestart = NativeSurface.rpc("Updater", "readyForRestart", {
  payload: Schema.Void,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "Updater", methods: ["readyForRestart"] })
  ),
  endpoint: "mutation",
  support: NativeSurface.support.supported
})

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
    options: UpdaterCheckOptions
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
  "@orika/native/UpdaterClient"
) {}

export type UpdaterServiceApi = UpdaterClientApi

export class Updater extends Context.Service<Updater, UpdaterServiceApi>()(
  "@orika/native/Updater"
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
): Layer.Layer<UpdaterClient> => UpdaterSurface.bridgeClientLayer(exchange, options)

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
    ),
  bridgeClient: (client, exchange) =>
    updaterClientFromRpcClient(client, () =>
      subscribeUpdaterEvent(exchange, "Updater.PreparingRestart")
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
): UpdaterClientApi =>
  Object.freeze({
    check: (input) =>
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

const subscribeUpdaterEvent = (
  exchange: BridgeClientExchange,
  method: "Updater.PreparingRestart"
): Stream.Stream<UpdaterPreparingRestartEvent, UpdaterError, never> =>
  subscribeNativeEvent(exchange, method, UpdaterPreparingRestartEvent, StrictParseOptions)

const decodeUpdaterCheckInput = (
  input: unknown,
  operation: string
): Effect.Effect<UpdaterCheckInput, UpdaterError, never> =>
  decodeInput(UpdaterCheckInput, input, operation).pipe(
    Effect.flatMap((decoded) => validateUpdaterCheckInput(decoded, operation))
  )

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

const validateUpdaterCheckInput = (
  input: UpdaterCheckInput,
  operation: string
): Effect.Effect<UpdaterCheckInput, UpdaterError, never> => {
  const hasManifest = input.manifestJson !== undefined
  const hasTrustAnchors = input.trustAnchors !== undefined
  if (hasManifest === hasTrustAnchors) {
    return Effect.succeed(input)
  }
  const field = hasManifest ? "trustAnchors" : "manifestJson"
  const reason = hasManifest
    ? "is required when manifestJson is provided"
    : "is required when trustAnchors is provided"
  return Effect.fail(makeHostProtocolInvalidArgumentError(field, reason, operation))
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
