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
import { Context, Effect, Layer, Schema, Stream } from "effect"

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
  "native.invoke:Updater.check"
)
export const UpdaterDownload = updaterRpc(
  "download",
  UpdaterDownloadInput,
  UpdaterStatusResult,
  "native.invoke:Updater.download"
)
export const UpdaterInstall = updaterRpc(
  "install",
  UpdaterInstallInput,
  UpdaterStatusResult,
  "native.invoke:Updater.install"
)
export const UpdaterInstallAndRestart = updaterRpc(
  "installAndRestart",
  UpdaterInstallInput,
  UpdaterStatusResult,
  "native.invoke:Updater.installAndRestart"
)
export const UpdaterGetStatus = updaterRpc(
  "getStatus",
  Schema.Void,
  UpdaterStatusResult,
  "native.invoke:Updater.getStatus"
)
export const UpdaterReadyForRestart = updaterRpc(
  "readyForRestart",
  Schema.Void,
  Schema.Void,
  "native.invoke:Updater.readyForRestart"
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
) {}

export const UpdaterLive = Layer.effect(Updater)(
  Effect.gen(function* () {
    const client = yield* UpdaterClient
    return Object.freeze({
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

export const makeUpdaterClientLayer = (client: UpdaterClientApi): Layer.Layer<UpdaterClient> =>
  Layer.succeed(UpdaterClient)(client)

export const makeUpdaterServiceLayer = (client: UpdaterClientApi): Layer.Layer<Updater> =>
  Layer.provide(UpdaterLive, makeUpdaterClientLayer(client))

export const makeUpdaterBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<UpdaterClient> =>
  Layer.succeed(UpdaterClient)(makeUpdaterBridgeClient(exchange, options))

export type UpdaterRpc = RpcGroup.Rpcs<typeof UpdaterRpcGroup>

export type UpdaterRpcHandlers = Parameters<typeof UpdaterRpcGroup.toLayer>[0]

export const makeHostUpdaterRpcRuntime = (
  handlers: UpdaterRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<unknown> =>
  makeDesktopRpcHandlerRuntime(UpdaterRpcGroup, UpdaterRpcGroup.toLayer(handlers), runtimeOptions)

const StrictParseOptions = { onExcessProperty: "error" } as const

const makeUpdaterBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): UpdaterClientApi => {
  return Object.freeze({
    check: (input = {}) =>
      decodeUpdaterCheckInput(input, "Updater.check").pipe(
        Effect.flatMap((decoded) =>
          withUpdaterRpcClient(exchange, options, (client) =>
            runUpdaterRpc(client["Updater.check"](decoded), "Updater.check")
          )
        )
      ),
    download: (input = {}) =>
      decodeUpdaterDownloadInput(input, "Updater.download").pipe(
        Effect.flatMap((decoded) =>
          withUpdaterRpcClient(exchange, options, (client) =>
            runUpdaterRpc(client["Updater.download"](decoded), "Updater.download")
          )
        )
      ),
    install: (input = {}) =>
      decodeUpdaterInstallInput(input, "Updater.install").pipe(
        Effect.flatMap((decoded) =>
          withUpdaterRpcClient(exchange, options, (client) =>
            runUpdaterRpc(client["Updater.install"](decoded), "Updater.install")
          )
        )
      ),
    installAndRestart: (input = {}) =>
      decodeUpdaterInstallInput(input, "Updater.installAndRestart").pipe(
        Effect.flatMap((decoded) =>
          withUpdaterRpcClient(exchange, options, (client) =>
            runUpdaterRpc(client["Updater.installAndRestart"](decoded), "Updater.installAndRestart")
          )
        )
      ),
    getStatus: () =>
      withUpdaterRpcClient(exchange, options, (client) =>
        runUpdaterRpc(client["Updater.getStatus"](undefined), "Updater.getStatus")
      ),
    readyForRestart: () =>
      withUpdaterRpcClient(exchange, options, (client) =>
        runUpdaterRpc(client["Updater.readyForRestart"](undefined), "Updater.readyForRestart")
      ),
    onPreparingRestart: () => subscribeUpdaterEvent(exchange, "Updater.PreparingRestart")
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

const withUpdaterRpcClient = <A>(
  exchange: BridgeClientExchange,
  options: BridgeClientOptions,
  use: (client: UpdaterGeneratedClient) => Effect.Effect<A, UpdaterError, never>
): Effect.Effect<A, UpdaterError, never> =>
  Effect.scoped(
    RpcClient.make(UpdaterRpcGroup).pipe(
      Effect.map((client) => client as unknown as UpdaterGeneratedClient),
      Effect.flatMap(use),
      Effect.provide(makeUpdaterBridgeProtocolLayer(exchange, options))
    )
  )

const subscribeUpdaterEvent = (
  exchange: BridgeClientExchange,
  method: "Updater.PreparingRestart"
): Stream.Stream<UpdaterPreparingRestartEvent, UpdaterError, never> => {
  if (exchange.subscribe === undefined) {
    return Stream.fail(
      makeHostProtocolInvalidOutputError(method, "event exchange does not support subscriptions")
    )
  }

  return exchange
    .subscribe(method)
    .pipe(Stream.mapEffect((envelope) => decodeUpdaterEventEnvelope(method, envelope)))
}

const decodeUpdaterEventEnvelope = (
  operation: string,
  envelope: HostProtocolEventEnvelope
): Effect.Effect<UpdaterPreparingRestartEvent, UpdaterError, never> => {
  if (envelope.method !== operation) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(operation, `unexpected event method: ${envelope.method}`)
    )
  }

  return Effect.mapError(
    Schema.decodeUnknownEffect(UpdaterPreparingRestartEvent)(envelope.payload, StrictParseOptions),
    (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  )
}

const decodeUpdaterCheckInput = (
  input: unknown,
  operation: string
): Effect.Effect<UpdaterCheckInput, UpdaterError, never> =>
  decodeInput(UpdaterCheckInput, input, operation) as Effect.Effect<
    UpdaterCheckInput,
    UpdaterError,
    never
  >

const decodeUpdaterDownloadInput = (
  input: unknown,
  operation: string
): Effect.Effect<UpdaterDownloadInput, UpdaterError, never> =>
  decodeInput(UpdaterDownloadInput, input, operation) as Effect.Effect<
    UpdaterDownloadInput,
    UpdaterError,
    never
  >

const decodeUpdaterInstallInput = (
  input: unknown,
  operation: string
): Effect.Effect<UpdaterInstallInput, UpdaterError, never> =>
  decodeInput(UpdaterInstallInput, input, operation) as Effect.Effect<
    UpdaterInstallInput,
    UpdaterError,
    never
  >

const decodeInput = (
  schema: Schema.Schema<unknown>,
  input: unknown,
  operation: string
): Effect.Effect<unknown, UpdaterError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(schema)(input, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

function updaterRpc<Payload extends Schema.Schema<unknown>, Success extends Schema.Schema<unknown>>(
  method: string,
  payload: Payload,
  success: Success,
  capability: string
) {
  return Rpc.make(`Updater.${method}`, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}

interface UpdaterGeneratedClient {
  readonly "Updater.check": (
    input: UpdaterCheckInput
  ) => Effect.Effect<UpdaterCheckResult, unknown, never>
  readonly "Updater.download": (
    input: UpdaterDownloadInput
  ) => Effect.Effect<UpdaterStatusResult, unknown, never>
  readonly "Updater.install": (
    input: UpdaterInstallInput
  ) => Effect.Effect<UpdaterStatusResult, unknown, never>
  readonly "Updater.installAndRestart": (
    input: UpdaterInstallInput
  ) => Effect.Effect<UpdaterStatusResult, unknown, never>
  readonly "Updater.getStatus": (input: void) => Effect.Effect<UpdaterStatusResult, unknown, never>
  readonly "Updater.readyForRestart": (input: void) => Effect.Effect<void, unknown, never>
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

export const makeUnsupportedUpdaterClient = (): UpdaterClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, UpdaterError, never> =>
    Effect.fail(unsupportedError(method))
  const unsupportedStream = <A>(method: string): Stream.Stream<A, UpdaterError, never> =>
    Stream.fail(unsupportedError(method))
  return Object.freeze({
    check: () => unsupportedEffect<UpdaterCheckResult>("Updater.check"),
    download: () => unsupportedEffect<UpdaterStatusResult>("Updater.download"),
    install: () => unsupportedEffect<UpdaterStatusResult>("Updater.install"),
    installAndRestart: () => unsupportedEffect<UpdaterStatusResult>("Updater.installAndRestart"),
    getStatus: () => unsupportedEffect<UpdaterStatusResult>("Updater.getStatus"),
    readyForRestart: () => unsupportedEffect<void>("Updater.readyForRestart"),
    onPreparingRestart: () =>
      unsupportedStream<UpdaterPreparingRestartEvent>("Updater.PreparingRestart")
  } satisfies UpdaterClientApi)
}

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "phase-22",
    message: `unsupported Updater method until Phase 22: ${method}`,
    operation: method,
    recoverable: false
  })
