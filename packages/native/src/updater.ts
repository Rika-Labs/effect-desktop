import {
  BridgeRpc,
  Client,
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeRpcHandlers,
  type BridgeRpcLayer,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  Rpc,
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

export const UpdaterRpcs = BridgeRpc.fromGroup("Updater", UpdaterRpcGroup, UpdaterRpcEvents)

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

export type UpdaterRpcSpec = (typeof UpdaterRpcs)["spec"]

export const makeHostUpdaterBridgeRpcLayer = <Handlers extends BridgeRpcHandlers<UpdaterRpcSpec>>(
  handlers: Handlers
): BridgeRpcLayer<"Updater", UpdaterRpcSpec, Handlers, UpdaterRpcEvents> =>
  BridgeRpc.layer(UpdaterRpcs)(handlers)

const StrictParseOptions = { onExcessProperty: "error" } as const

const makeUpdaterBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): UpdaterClientApi => {
  const client = Client({ Updater: UpdaterRpcs }, exchange, options).Updater as unknown as {
    readonly check: (
      input: UpdaterCheckInput
    ) => Effect.Effect<UpdaterCheckResult, UpdaterError, never>
    readonly download: (
      input: UpdaterDownloadInput
    ) => Effect.Effect<UpdaterStatusResult, UpdaterError, never>
    readonly install: (
      input: UpdaterInstallInput
    ) => Effect.Effect<UpdaterStatusResult, UpdaterError, never>
    readonly installAndRestart: (
      input: UpdaterInstallInput
    ) => Effect.Effect<UpdaterStatusResult, UpdaterError, never>
    readonly getStatus: () => Effect.Effect<UpdaterStatusResult, UpdaterError, never>
    readonly readyForRestart: () => Effect.Effect<void, UpdaterError, never>
    readonly events: {
      readonly PreparingRestart: Stream.Stream<UpdaterPreparingRestartEvent, UpdaterError, never>
    }
  }
  return Object.freeze({
    check: (input = {}) =>
      decodeUpdaterCheckInput(input, "Updater.check").pipe(Effect.flatMap(client.check)),
    download: (input = {}) =>
      decodeUpdaterDownloadInput(input, "Updater.download").pipe(Effect.flatMap(client.download)),
    install: (input = {}) =>
      decodeUpdaterInstallInput(input, "Updater.install").pipe(Effect.flatMap(client.install)),
    installAndRestart: (input = {}) =>
      decodeUpdaterInstallInput(input, "Updater.installAndRestart").pipe(
        Effect.flatMap(client.installAndRestart)
      ),
    getStatus: () => client.getStatus(),
    readyForRestart: () => client.readyForRestart(),
    onPreparingRestart: () => client.events.PreparingRestart
  } satisfies UpdaterClientApi)
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
