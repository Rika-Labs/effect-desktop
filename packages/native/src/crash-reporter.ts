import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolInvalidStateError,
  redactForJson,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { type PermissionRegistry, P, type DesktopRpcClient } from "@effect-desktop/core"
import { Clock, Context, Effect, Layer, Ref, Schema } from "effect"

import { NativeSurface } from "./native-surface.js"
import {
  CrashReporterBreadcrumbInput,
  CrashReporterFlushResult,
  CrashReporterReport as CrashReporterReportSchema,
  CrashReporterGetReportsResult,
  CrashReporterStartInput
} from "./contracts/crash-reporter.js"

export type CrashReporterError = HostProtocolError

export type CrashReporterStartOptions = Schema.Schema.Type<typeof CrashReporterStartInput>

export type CrashReporterBreadcrumb = Schema.Schema.Type<typeof CrashReporterBreadcrumbInput>

export type CrashReporterReport = Schema.Schema.Type<typeof CrashReporterReportSchema>

const PartialSupportReason = "native-crash-capture-unavailable"

const CrashReporterSupport = NativeSurface.support.partial(PartialSupportReason, {
  platforms: [
    { platform: "macos", status: "partial", reason: PartialSupportReason },
    { platform: "windows", status: "partial", reason: PartialSupportReason },
    { platform: "linux", status: "partial", reason: PartialSupportReason }
  ]
})

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
export const CrashReporterGetReports = crashReporterRpc(
  "getReports",
  Schema.Void,
  CrashReporterGetReportsResult,
  P.nativeInvoke({ primitive: "CrashReporter", methods: ["getReports"] })
)
export const CrashReporterRpcEvents = Object.freeze({})

export type CrashReporterRpcEvents = typeof CrashReporterRpcEvents

const CrashReporterRpcGroup = RpcGroup.make(
  CrashReporterStart,
  CrashReporterRecordBreadcrumb,
  CrashReporterFlush,
  CrashReporterGetReports
)

export const CrashReporterRpcs: RpcGroup.RpcGroup<CrashReporterRpc> = CrashReporterRpcGroup

export const CrashReporterMethodNames = Object.freeze([
  "start",
  "recordBreadcrumb",
  "flush",
  "getReports"
] as const)

export interface CrashReporterClientApi {
  readonly start: (
    options?: CrashReporterStartOptions
  ) => Effect.Effect<void, CrashReporterError, never>
  readonly recordBreadcrumb: (
    breadcrumb: CrashReporterBreadcrumb
  ) => Effect.Effect<void, CrashReporterError, never>
  readonly flush: () => Effect.Effect<CrashReporterFlushResult, CrashReporterError, never>
  readonly getReports: () => Effect.Effect<CrashReporterGetReportsResult, CrashReporterError, never>
}

export class CrashReporterClient extends Context.Service<
  CrashReporterClient,
  CrashReporterClientApi
>()("@effect-desktop/native/CrashReporterClient") {}

export type CrashReporterServiceApi = CrashReporterClientApi

export class CrashReporter extends Context.Service<CrashReporter, CrashReporterServiceApi>()(
  "@effect-desktop/native/CrashReporter"
) {
  static readonly layer = Layer.effect(CrashReporter)(
    Effect.gen(function* () {
      const client = yield* CrashReporterClient
      return CrashReporter.of({
        start: (options) => client.start(options),
        recordBreadcrumb: (breadcrumb) => client.recordBreadcrumb(breadcrumb),
        flush: () => client.flush(),
        getReports: () => client.getReports()
      } satisfies CrashReporterServiceApi)
    })
  )
}

export const CrashReporterLive = CrashReporter.layer

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
): Layer.Layer<CrashReporterClient> => CrashReporterSurface.bridgeClientLayer(exchange, options)

export type CrashReporterRpc = RpcGroup.Rpcs<typeof CrashReporterRpcGroup>

export type CrashReporterRpcHandlers = RpcGroup.HandlersFrom<CrashReporterRpc>

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
    }),
  "CrashReporter.getReports": () =>
    Effect.gen(function* () {
      const reporter = yield* CrashReporter
      return yield* reporter.getReports()
    })
})

export const CrashReporterSurface = NativeSurface.make("CrashReporter", CrashReporterRpcGroup, {
  service: CrashReporterClient,
  capabilities: CrashReporterMethodNames,
  handlers: CrashReporterHandlersLive,
  client: (client) => crashReporterClientFromRpcClient(client)
})

export const makeHostCrashReporterRpcRuntime = (
  handlers: CrashReporterRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  CrashReporterSurface.hostRuntime(handlers, runtimeOptions)

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
        Ref.update(
          state,
          () =>
            ({
              breadcrumbs: [],
              started: options.enabled ?? true
            }) satisfies CrashReporterState
        ),
      recordBreadcrumb: (breadcrumb) =>
        Effect.gen(function* () {
          const validated = yield* validateBreadcrumb(breadcrumb)
          const current = yield* Ref.get(state)
          if (!current.started) {
            return yield* Effect.fail(notStartedError("CrashReporter.recordBreadcrumb"))
          }
          const normalized = yield* normalizeBreadcrumb(validated)
          yield* Ref.update(state, (latest) => ({
            ...latest,
            breadcrumbs: [...latest.breadcrumbs, normalized]
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
        }),
      getReports: () => Effect.succeed(new CrashReporterGetReportsResult({ reports: [] }))
    } satisfies CrashReporterClientApi)
  })

const crashReporterClientFromRpcClient = (
  client: DesktopRpcClient<CrashReporterRpc>
): CrashReporterClientApi =>
  Object.freeze({
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
        Effect.flatMap(normalizeBreadcrumb),
        Effect.flatMap((validated) =>
          runCrashReporterRpc(
            client["CrashReporter.recordBreadcrumb"](makeBreadcrumbInput(validated)),
            "CrashReporter.recordBreadcrumb"
          )
        )
      ),
    flush: () =>
      runCrashReporterRpc(client["CrashReporter.flush"](undefined), "CrashReporter.flush"),
    getReports: () =>
      runCrashReporterRpc(client["CrashReporter.getReports"](undefined), "CrashReporter.getReports")
  } satisfies CrashReporterClientApi)

interface CrashReporterState {
  readonly breadcrumbs: ReadonlyArray<CrashReporterBreadcrumb>
  readonly started: boolean
}

function crashReporterRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc("CrashReporter", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: method === "getReports" ? "query" : "mutation",
    support: CrashReporterSupport
  })
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

const normalizeBreadcrumb = (
  breadcrumb: CrashReporterBreadcrumb
): Effect.Effect<CrashReporterBreadcrumb, never, never> =>
  Effect.gen(function* () {
    const timestamp = breadcrumb.timestamp ?? (yield* Clock.currentTimeMillis)
    return {
      category: breadcrumb.category,
      message: breadcrumb.message,
      ...(breadcrumb.details === undefined ? {} : { details: breadcrumb.details }),
      timestamp
    }
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
