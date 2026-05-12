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
  makeHostProtocolInvalidStateError,
  redact,
  Rpc,
  RpcCapability,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Option, Ref, Schema } from "effect"

import {
  CrashReporterBreadcrumbInput,
  CrashReporterFlushResult,
  CrashReporterStartInput
} from "./contracts/crash-reporter.js"

export type CrashReporterError = HostProtocolError

export type CrashReporterStartOptions = Schema.Schema.Type<typeof CrashReporterStartInput> & {
  readonly uploadHandler?: CrashReportUploadHandler
}

export type CrashReporterBreadcrumb = Schema.Schema.Type<typeof CrashReporterBreadcrumbInput>

export type CrashReportUploadHandler = (
  breadcrumbs: ReadonlyArray<CrashReporterBreadcrumb>
) => Effect.Effect<void, CrashReporterError, never>

export const CrashReporterStart = crashReporterRpc(
  "start",
  CrashReporterStartInput,
  Schema.Void,
  "native.invoke:CrashReporter.start"
)
export const CrashReporterRecordBreadcrumb = crashReporterRpc(
  "recordBreadcrumb",
  CrashReporterBreadcrumbInput,
  Schema.Void,
  "native.invoke:CrashReporter.recordBreadcrumb"
)
export const CrashReporterFlush = crashReporterRpc(
  "flush",
  Schema.Void,
  CrashReporterFlushResult,
  "native.invoke:CrashReporter.flush"
)
export const CrashReporterSetUploadHandler = crashReporterRpc(
  "setUploadHandler",
  Schema.Void,
  Schema.Void,
  "native.invoke:CrashReporter.setUploadHandler"
)

export const CrashReporterRpcEvents = Object.freeze({})

export type CrashReporterRpcEvents = typeof CrashReporterRpcEvents

const CrashReporterRpcGroup = RpcGroup.make(
  CrashReporterStart,
  CrashReporterRecordBreadcrumb,
  CrashReporterFlush,
  CrashReporterSetUploadHandler
)

export const CrashReporterRpcs = BridgeRpc.fromGroup(
  "CrashReporter",
  CrashReporterRpcGroup,
  CrashReporterRpcEvents
)

export const CrashReporterMethodNames = Object.freeze([
  "start",
  "recordBreadcrumb",
  "flush",
  "setUploadHandler"
] as const)

export interface CrashReporterClientApi {
  readonly start: (
    options?: CrashReporterStartOptions
  ) => Effect.Effect<void, CrashReporterError, never>
  readonly recordBreadcrumb: (
    breadcrumb: CrashReporterBreadcrumb
  ) => Effect.Effect<void, CrashReporterError, never>
  readonly flush: () => Effect.Effect<CrashReporterFlushResult, CrashReporterError, never>
  readonly setUploadHandler: (
    handler: CrashReportUploadHandler
  ) => Effect.Effect<void, CrashReporterError, never>
}

export class CrashReporterClient extends Context.Service<
  CrashReporterClient,
  CrashReporterClientApi
>()("@effect-desktop/native/CrashReporterClient") {}

export type CrashReporterServiceApi = CrashReporterClientApi

export class CrashReporter extends Context.Service<CrashReporter, CrashReporterServiceApi>()(
  "@effect-desktop/native/CrashReporter"
) {}

export const CrashReporterLive = Layer.effect(CrashReporter)(
  Effect.gen(function* () {
    const client = yield* CrashReporterClient
    return Object.freeze({
      start: (options) => client.start(options),
      recordBreadcrumb: (breadcrumb) => client.recordBreadcrumb(breadcrumb),
      flush: () => client.flush(),
      setUploadHandler: (handler) => client.setUploadHandler(handler)
    } satisfies CrashReporterServiceApi)
  })
)

export const makeCrashReporterClientLayer = (
  client: CrashReporterClientApi
): Layer.Layer<CrashReporterClient> => Layer.succeed(CrashReporterClient)(client)

export const makeCrashReporterServiceLayer = (
  client: CrashReporterClientApi
): Layer.Layer<CrashReporter> =>
  Layer.provide(CrashReporterLive, makeCrashReporterClientLayer(client))

export const makeCrashReporterBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<CrashReporterClient> =>
  Layer.succeed(CrashReporterClient)(makeCrashReporterBridgeClient(exchange, options))

export type CrashReporterRpcSpec = (typeof CrashReporterRpcs)["spec"]

export const makeHostCrashReporterBridgeRpcLayer = <
  Handlers extends BridgeRpcHandlers<CrashReporterRpcSpec>
>(
  handlers: Handlers
): BridgeRpcLayer<"CrashReporter", CrashReporterRpcSpec, Handlers, CrashReporterRpcEvents> =>
  BridgeRpc.layer(CrashReporterRpcs)(handlers)

export const makeCrashReporterMemoryClient = (): Effect.Effect<
  CrashReporterClientApi,
  never,
  never
> =>
  Effect.gen(function* () {
    const state = yield* Ref.make<CrashReporterState>({
      breadcrumbs: [],
      started: false
    })
    return Object.freeze({
      start: (options = {}) =>
        Ref.update(state, () => {
          const next = {
            breadcrumbs: [],
            started: options.enabled ?? true
          } satisfies CrashReporterState
          return options.uploadHandler === undefined
            ? next
            : { ...next, uploadHandler: options.uploadHandler }
        }),
      recordBreadcrumb: (breadcrumb) =>
        Effect.gen(function* () {
          const validated = yield* validateBreadcrumb(breadcrumb)
          const current = yield* Ref.get(state)
          if (!current.started) {
            return yield* Effect.fail(notStartedError("CrashReporter.recordBreadcrumb"))
          }
          yield* Ref.update(state, (latest) => ({
            ...latest,
            breadcrumbs: [...latest.breadcrumbs, normalizeBreadcrumb(validated)]
          }))
        }),
      flush: () =>
        Effect.gen(function* () {
          const drained = yield* Ref.modify(state, (current) => {
            if (!current.started) {
              return [Option.none<CrashReporterFlushBatch>(), current]
            }
            const batch =
              current.uploadHandler === undefined
                ? { breadcrumbs: current.breadcrumbs }
                : { breadcrumbs: current.breadcrumbs, uploadHandler: current.uploadHandler }
            return [Option.some(batch), { ...current, breadcrumbs: [] }]
          })
          if (Option.isNone(drained)) {
            return yield* Effect.fail(notStartedError("CrashReporter.flush"))
          }
          const batch = drained.value
          if (batch.uploadHandler !== undefined && batch.breadcrumbs.length > 0) {
            yield* batch.uploadHandler(batch.breadcrumbs).pipe(
              Effect.tapError(() =>
                Ref.update(state, (latest) => ({
                  ...latest,
                  breadcrumbs: [...batch.breadcrumbs, ...latest.breadcrumbs]
                }))
              )
            )
          }
          return new CrashReporterFlushResult({ flushed: batch.breadcrumbs.length })
        }),
      setUploadHandler: (handler) =>
        Ref.update(state, (latest) => ({ ...latest, uploadHandler: handler }))
    } satisfies CrashReporterClientApi)
  })

const makeCrashReporterBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): CrashReporterClientApi => {
  const client = Client(
    {
      CrashReporter: CrashReporterRpcs
    },
    exchange,
    options
  ).CrashReporter as unknown as {
    readonly start: (
      input: CrashReporterStartInput
    ) => Effect.Effect<void, CrashReporterError, never>
    readonly recordBreadcrumb: (
      input: CrashReporterBreadcrumbInput
    ) => Effect.Effect<void, CrashReporterError, never>
    readonly flush: () => Effect.Effect<CrashReporterFlushResult, CrashReporterError, never>
  }
  return Object.freeze({
    start: (input = {}) =>
      input.uploadHandler !== undefined
        ? Effect.fail(unsupportedError("CrashReporter.start", "phase-22"))
        : input.enabled === undefined
          ? client.start(new CrashReporterStartInput({}))
          : client.start(new CrashReporterStartInput({ enabled: input.enabled })),
    recordBreadcrumb: (input) =>
      validateBreadcrumb(input).pipe(
        Effect.flatMap((validated) => client.recordBreadcrumb(makeBreadcrumbInput(validated)))
      ),
    flush: () => client.flush(),
    setUploadHandler: () =>
      Effect.fail(unsupportedError("CrashReporter.setUploadHandler", "phase-22"))
  } satisfies CrashReporterClientApi)
}

export const makeUnsupportedCrashReporterClient = (): CrashReporterClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, CrashReporterError, never> =>
    Effect.fail(
      unsupportedError(method, "host CrashReporter platform adapter is not implemented yet")
    )
  return Object.freeze({
    start: () => unsupportedEffect<void>("CrashReporter.start"),
    recordBreadcrumb: () => unsupportedEffect<void>("CrashReporter.recordBreadcrumb"),
    flush: () => unsupportedEffect<CrashReporterFlushResult>("CrashReporter.flush"),
    setUploadHandler: () => unsupportedEffect<void>("CrashReporter.setUploadHandler")
  } satisfies CrashReporterClientApi)
}

interface CrashReporterState {
  readonly breadcrumbs: ReadonlyArray<CrashReporterBreadcrumb>
  readonly started: boolean
  readonly uploadHandler?: CrashReportUploadHandler
}

interface CrashReporterFlushBatch {
  readonly breadcrumbs: ReadonlyArray<CrashReporterBreadcrumb>
  readonly uploadHandler?: CrashReportUploadHandler
}

function crashReporterRpc<
  Payload extends Schema.Schema<unknown>,
  Success extends Schema.Schema<unknown>
>(method: string, payload: Payload, success: Success, capability: string) {
  return Rpc.make(`CrashReporter.${method}`, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}

const validateBreadcrumb = (
  breadcrumb: CrashReporterBreadcrumb
): Effect.Effect<CrashReporterBreadcrumb, CrashReporterError, never> =>
  Schema.decodeUnknownEffect(CrashReporterBreadcrumbInput)(breadcrumb).pipe(
    Effect.mapError((cause) =>
      makeHostProtocolInvalidArgumentError(
        "category",
        cause instanceof Error ? cause.message : String(cause),
        "CrashReporter.recordBreadcrumb"
      )
    ),
    Effect.flatMap((validated) =>
      validated.details === undefined
        ? Effect.succeed(validated)
        : normalizeBreadcrumbDetails(validated.details).pipe(
            Effect.map((details) => ({
              category: validated.category,
              message: validated.message,
              details,
              ...(validated.timestamp === undefined ? {} : { timestamp: validated.timestamp })
            }))
          )
    )
  )

const normalizeBreadcrumb = (breadcrumb: CrashReporterBreadcrumb): CrashReporterBreadcrumb => ({
  category: breadcrumb.category,
  message: breadcrumb.message,
  ...(breadcrumb.details === undefined ? {} : { details: breadcrumb.details }),
  timestamp: breadcrumb.timestamp ?? Date.now()
})

const makeBreadcrumbInput = (breadcrumb: CrashReporterBreadcrumb): CrashReporterBreadcrumbInput =>
  breadcrumb.timestamp === undefined
    ? new CrashReporterBreadcrumbInput({
        category: breadcrumb.category,
        message: breadcrumb.message,
        ...(breadcrumb.details === undefined ? {} : { details: breadcrumb.details })
      })
    : new CrashReporterBreadcrumbInput({
        category: breadcrumb.category,
        message: breadcrumb.message,
        ...(breadcrumb.details === undefined ? {} : { details: breadcrumb.details }),
        timestamp: breadcrumb.timestamp
      })

const normalizeBreadcrumbDetails = (
  details: unknown
): Effect.Effect<unknown, CrashReporterError, never> =>
  Effect.try({
    try: () => {
      const redacted = redact(details)
      if (JSON.stringify(redacted) === undefined) {
        throw new Error("details cannot be represented in host JSON")
      }
      return redacted
    },
    catch: (error) =>
      makeHostProtocolInvalidArgumentError(
        "details",
        error instanceof Error ? error.message : String(error),
        "CrashReporter.recordBreadcrumb"
      )
  })

const notStartedError = (operation: string): CrashReporterError =>
  makeHostProtocolInvalidStateError("not-started", operation, operation)

const unsupportedError = (method: string, reason: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason,
    message: `unsupported CrashReporter method: ${method}`,
    operation: method,
    recoverable: false
  })
