import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolError as HostProtocolErrorSchema,
  makeDesktopClientProtocol,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolInvalidStateError,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  redactForJson,
  Rpc,
  RpcClient,
  RpcCapability,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { type PermissionRegistry, P, DesktopRpc, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Ref, Schema } from "effect"

import { makeNativeHostRpcRuntime } from "./native-rpc-runtime.js"
import {
  CrashReporterBreadcrumbInput,
  CrashReporterFlushResult,
  CrashReporterStartInput
} from "./contracts/crash-reporter.js"

export type CrashReporterError = HostProtocolError

export type CrashReporterStartOptions = Schema.Schema.Type<typeof CrashReporterStartInput>

export type CrashReporterBreadcrumb = Schema.Schema.Type<typeof CrashReporterBreadcrumbInput>

export const CrashReporterStart = crashReporterRpc(
  "start",
  CrashReporterStartInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "CrashReporter", methods: ["start"] })
)
export const CrashReporterRecordBreadcrumb = crashReporterRpc(
  "recordBreadcrumb",
  CrashReporterBreadcrumbInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "CrashReporter", methods: ["recordBreadcrumb"] })
)
export const CrashReporterFlush = crashReporterRpc(
  "flush",
  Schema.Void,
  CrashReporterFlushResult,
  P.nativeInvoke({ primitive: "CrashReporter", methods: ["flush"] })
)
export const CrashReporterRpcEvents = Object.freeze({})

export type CrashReporterRpcEvents = typeof CrashReporterRpcEvents

const CrashReporterRpcGroup = RpcGroup.make(
  CrashReporterStart,
  CrashReporterRecordBreadcrumb,
  CrashReporterFlush
)

export const CrashReporterRpcs: RpcGroup.RpcGroup<CrashReporterRpc> = CrashReporterRpcGroup

export const CrashReporterMethodNames = Object.freeze([
  "start",
  "recordBreadcrumb",
  "flush"
] as const)

export interface CrashReporterClientApi {
  readonly start: (
    options?: CrashReporterStartOptions
  ) => Effect.Effect<void, CrashReporterError, never>
  readonly recordBreadcrumb: (
    breadcrumb: CrashReporterBreadcrumb
  ) => Effect.Effect<void, CrashReporterError, never>
  readonly flush: () => Effect.Effect<CrashReporterFlushResult, CrashReporterError, never>
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
      flush: () => client.flush()
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
  Layer.provide(
    CrashReporterSurface.clientLayer,
    makeCrashReporterBridgeProtocolLayer(exchange, options)
  )

export type CrashReporterRpc = RpcGroup.Rpcs<typeof CrashReporterRpcGroup>

export type CrashReporterRpcHandlers = Parameters<typeof CrashReporterRpcGroup.toLayer>[0]

export const CrashReporterHandlersLive = CrashReporterRpcGroup.toLayer({
  "CrashReporter.start": (input) =>
    Effect.gen(function* () {
      const reporter = yield* CrashReporter
      yield* reporter.start(input)
    }),
  "CrashReporter.recordBreadcrumb": (input) =>
    Effect.gen(function* () {
      const reporter = yield* CrashReporter
      yield* reporter.recordBreadcrumb(input)
    }),
  "CrashReporter.flush": () =>
    Effect.gen(function* () {
      const reporter = yield* CrashReporter
      return yield* reporter.flush()
    })
})

export const CrashReporterSurface = DesktopRpc.surface("CrashReporter", CrashReporterRpcGroup, {
  service: CrashReporterClient,
  handlers: CrashReporterHandlersLive,
  client: (client) => crashReporterClientFromRpcClient(client)
})

export const makeHostCrashReporterRpcRuntime = (
  handlers: CrashReporterRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  makeNativeHostRpcRuntime(
    CrashReporterRpcGroup,
    CrashReporterRpcGroup.toLayer(handlers),
    runtimeOptions
  )

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
          return {
            breadcrumbs: [],
            started: options.enabled ?? true
          } satisfies CrashReporterState
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
              return [undefined, current] as const
            }
            return [current.breadcrumbs, { ...current, breadcrumbs: [] }] as const
          })
          if (drained === undefined) {
            return yield* Effect.fail(notStartedError("CrashReporter.flush"))
          }
          return new CrashReporterFlushResult({ flushed: drained.length })
        })
    } satisfies CrashReporterClientApi)
  })

const crashReporterClientFromRpcClient = (
  client: DesktopRpcClient<CrashReporterRpc>
): CrashReporterClientApi => {
  return Object.freeze({
    start: (input = {}) =>
      input.enabled === undefined
        ? runCrashReporterRpc(
            client["CrashReporter.start"](new CrashReporterStartInput({})),
            "CrashReporter.start"
          )
        : runCrashReporterRpc(
            client["CrashReporter.start"](
              new CrashReporterStartInput({ enabled: Boolean(input.enabled) })
            ),
            "CrashReporter.start"
          ),
    recordBreadcrumb: (input) =>
      validateBreadcrumb(input).pipe(
        Effect.flatMap((validated) =>
          runCrashReporterRpc(
            client["CrashReporter.recordBreadcrumb"](makeBreadcrumbInput(validated)),
            "CrashReporter.recordBreadcrumb"
          )
        )
      ),
    flush: () =>
      runCrashReporterRpc(client["CrashReporter.flush"](undefined), "CrashReporter.flush")
  } satisfies CrashReporterClientApi)
}

const makeCrashReporterBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

interface CrashReporterState {
  readonly breadcrumbs: ReadonlyArray<CrashReporterBreadcrumb>
  readonly started: boolean
}

function crashReporterRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return Rpc.make(`CrashReporter.${method}` as const, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability(capability))
}

const runCrashReporterRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, CrashReporterError, never> =>
  effect.pipe(
    Effect.mapError(mapCrashReporterRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapCrashReporterRpcClientError = (error: unknown): CrashReporterError =>
  isCrashReporterError(error)
    ? error
    : makeHostProtocolInternalError("CrashReporter RPC client failed", "CrashReporter")

const isCrashReporterError = (error: unknown): error is CrashReporterError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

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
      const redacted = redactForJson(details)
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

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
