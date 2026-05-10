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

export const UpdaterApiSpec = Object.freeze({
  check: {
    input: UpdaterCheckInput,
    output: UpdaterCheckResult,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:Updater.check"
  },
  download: {
    input: UpdaterDownloadInput,
    output: UpdaterStatusResult,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:Updater.download"
  },
  install: {
    input: UpdaterInstallInput,
    output: UpdaterStatusResult,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:Updater.install"
  },
  installAndRestart: {
    input: UpdaterInstallInput,
    output: UpdaterStatusResult,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:Updater.installAndRestart"
  },
  getStatus: {
    input: Schema.Void,
    output: UpdaterStatusResult,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:Updater.getStatus"
  },
  readyForRestart: {
    input: Schema.Void,
    output: Schema.Void,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:Updater.readyForRestart"
  }
}) satisfies ApiContractSpec

export type UpdaterApiSpec = typeof UpdaterApiSpec

export const UpdaterApiEvents = Object.freeze({
  PreparingRestart: { payload: UpdaterPreparingRestartEvent }
})

export type UpdaterApiEvents = typeof UpdaterApiEvents

export const UpdaterApi: ApiContractClass<"Updater", UpdaterApiSpec, UpdaterApiEvents> = (() => {
  const contract = class {
    static readonly tag = "Updater"
    static readonly spec = UpdaterApiSpec
    static readonly events = UpdaterApiEvents

    static layer<Handlers extends ApiHandlers<UpdaterApiSpec>>(
      handlers: Handlers
    ): ApiLayer<"Updater", UpdaterApiSpec, Handlers, UpdaterApiEvents> {
      return Object.freeze({ contract, handlers: Object.freeze(handlers) })
    }
  } as ApiContractClass<"Updater", UpdaterApiSpec, UpdaterApiEvents>

  return Object.freeze(contract)
})()

export const registerUpdaterApi = (): Effect.Effect<
  ApiContractClass<"Updater", UpdaterApiSpec, UpdaterApiEvents>,
  ApiContractError,
  never
> =>
  Effect.gen(function* () {
    const existing = yield* Api.get("Updater")
    if (Option.isSome(existing)) {
      return existing.value as ApiContractClass<"Updater", UpdaterApiSpec, UpdaterApiEvents>
    }
    return yield* Api.Tag("Updater")<unknown>()(UpdaterApiSpec, UpdaterApiEvents)
  })

export const UpdaterMethodNames = Object.freeze(
  Object.keys(UpdaterApiSpec) as ReadonlyArray<keyof UpdaterApiSpec>
)

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
  exchange: ApiClientExchange,
  options: ApiClientOptions = {}
): Layer.Layer<UpdaterClient> =>
  Layer.succeed(UpdaterClient)(makeUpdaterBridgeClient(exchange, options))

export const makeHostUpdaterApiLayer = <Handlers extends ApiHandlers<UpdaterApiSpec>>(
  handlers: Handlers
): ApiLayer<"Updater", UpdaterApiSpec, Handlers, UpdaterApiEvents> => UpdaterApi.layer(handlers)

const StrictParseOptions = { onExcessProperty: "error" } as const

const makeUpdaterBridgeClient = (
  exchange: ApiClientExchange,
  options: ApiClientOptions
): UpdaterClientApi => {
  const client = Client({ Updater: UpdaterApi }, exchange, options).Updater
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
