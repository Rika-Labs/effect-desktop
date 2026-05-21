import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolPermissionDeniedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolInvalidStateError,
  redactForJson,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import {
  type AuditEventsApi,
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError,
  emitAuditEvent,
  P,
  PermissionActor,
  PermissionContext,
  PermissionDeniedError,
  permissionAuditEvent,
  type DesktopRpcClient
} from "@effect-desktop/core"
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

const Surface = "CrashReporter"
const PartialSupportReason = "native-crash-capture-unavailable"
const CrashReporterActor = new PermissionActor({ kind: "app", id: "crash-reporter" })

const CrashReporterSupport = NativeSurface.support.partial(PartialSupportReason, {
  platforms: [
    { platform: "macos", status: "partial", reason: PartialSupportReason },
    { platform: "windows", status: "partial", reason: PartialSupportReason },
    { platform: "linux", status: "partial", reason: PartialSupportReason }
  ]
})
const CrashReporterLocalArtifactSupport = NativeSurface.support.supported

export const CrashReporterStart = NativeSurface.rpc(Surface, "start", {
  payload: CrashReporterStartInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "CrashReporter", methods: ["start"] })
  ),
  endpoint: "mutation",
  support: CrashReporterSupport
})
export const CrashReporterRecordBreadcrumb = NativeSurface.rpc(Surface, "recordBreadcrumb", {
  payload: CrashReporterBreadcrumbInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "CrashReporter", methods: ["recordBreadcrumb"] })
  ),
  endpoint: "mutation",
  support: CrashReporterSupport
})
export const CrashReporterFlush = NativeSurface.rpc(Surface, "flush", {
  payload: Schema.Void,
  success: CrashReporterFlushResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "CrashReporter", methods: ["flush"] })
  ),
  endpoint: "mutation",
  support: CrashReporterLocalArtifactSupport
})
export const CrashReporterGetReports = NativeSurface.rpc(Surface, "getReports", {
  payload: Schema.Void,
  success: CrashReporterGetReportsResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: "CrashReporter", methods: ["getReports"] })
  ),
  endpoint: "query",
  support: CrashReporterLocalArtifactSupport
})
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

export interface CrashReporterServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly audit?: AuditEventsApi
}

export class CrashReporter extends Context.Service<CrashReporter, CrashReporterServiceApi>()(
  "@effect-desktop/native/CrashReporter"
) {
  static readonly layer = Layer.effect(CrashReporter)(
    Effect.gen(function* () {
      const client = yield* CrashReporterClient
      const permissions = yield* PermissionRegistry
      return makeCrashReporterService(client, { permissions })
    })
  )
}

export const CrashReporterLive = CrashReporter.layer

export const makeCrashReporterClientLayer = (
  client: CrashReporterClientApi
): Layer.Layer<CrashReporterClient> => Layer.succeed(CrashReporterClient)(client)

export const makeCrashReporterServiceLayer = (
  client: CrashReporterClientApi,
  options: CrashReporterServiceOptions
): Layer.Layer<CrashReporter> =>
  Layer.effect(CrashReporter)(Effect.succeed(makeCrashReporterService(client, options)))

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

export const CrashReporterSurface = NativeSurface.make(Surface, CrashReporterRpcGroup, {
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
      validateStartOptions(input).pipe(
        Effect.flatMap((valid) =>
          valid.enabled === undefined
            ? runCrashReporterRpc(
                client["CrashReporter.start"](new CrashReporterStartInput({})),
                "CrashReporter.start"
              )
            : runCrashReporterRpc(
                client["CrashReporter.start"](
                  new CrashReporterStartInput({ enabled: valid.enabled })
                ),
                "CrashReporter.start"
              )
        )
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

const makeCrashReporterService = (
  client: CrashReporterClientApi,
  options: CrashReporterServiceOptions
): CrashReporterServiceApi =>
  Object.freeze({
    start: (input) =>
      validateStartOptions(input).pipe(
        Effect.flatMap((valid) =>
          authorize(options, "start").pipe(
            Effect.andThen(client.start(valid)),
            Effect.tap(() => emitUseAudit(options, "start")),
            Effect.tapError((error) => emitFailureAudit(options, "start", error))
          )
        )
      ),
    recordBreadcrumb: (input) =>
      validateBreadcrumb(input).pipe(
        Effect.flatMap(normalizeBreadcrumb),
        Effect.flatMap((valid) =>
          authorize(options, "recordBreadcrumb").pipe(
            Effect.andThen(client.recordBreadcrumb(valid)),
            Effect.tap(() => emitUseAudit(options, "recordBreadcrumb")),
            Effect.tapError((error) => emitFailureAudit(options, "recordBreadcrumb", error))
          )
        )
      ),
    flush: () =>
      authorize(options, "flush").pipe(
        Effect.andThen(client.flush()),
        Effect.tap((result) => emitUseAudit(options, "flush", { flushed: result.flushed })),
        Effect.tapError((error) => emitFailureAudit(options, "flush", error))
      ),
    getReports: () =>
      authorize(options, "getReports").pipe(
        Effect.andThen(client.getReports()),
        Effect.tap((result) =>
          emitUseAudit(options, "getReports", { reports: result.reports.length })
        ),
        Effect.tapError((error) => emitFailureAudit(options, "getReports", error))
      )
  } satisfies CrashReporterServiceApi)

interface CrashReporterState {
  readonly breadcrumbs: ReadonlyArray<CrashReporterBreadcrumb>
  readonly started: boolean
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

const validateStartOptions = (
  options: CrashReporterStartOptions | undefined
): Effect.Effect<CrashReporterStartInput, CrashReporterError, never> =>
  Schema.decodeUnknownEffect(CrashReporterStartInput)(options ?? {}).pipe(
    Effect.mapError((cause) =>
      makeHostProtocolInvalidArgumentError(
        "enabled",
        cause instanceof Error ? cause.message : String(cause),
        "CrashReporter.start"
      )
    )
  )

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

const authorize = (
  options: CrashReporterServiceOptions,
  method: (typeof CrashReporterMethodNames)[number]
): Effect.Effect<void, CrashReporterError, never> =>
  options.permissions
    .check(
      P.nativeInvoke({ primitive: Surface, methods: [method] }),
      new PermissionContext({
        actor: CrashReporterActor,
        resource: "crash-reporter",
        traceId: operation(method)
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.tapError((error) =>
        error instanceof PermissionDeniedError
          ? emitDeniedAudit(options, method, error)
          : Effect.void
      ),
      Effect.mapError((error: PermissionRegistryError): CrashReporterError => {
        if (error instanceof PermissionDeniedError) {
          return new HostProtocolPermissionDeniedError({
            tag: "PermissionDenied",
            message: "permission denied for native.invoke",
            operation: operation(method),
            capability: P.nativeInvoke({ primitive: Surface, methods: [method] }).kind,
            resource: error.traceId,
            recoverable: false
          })
        }
        return makeHostProtocolInternalError(
          `crash reporter permission failure: ${error._tag}`,
          operation(method)
        )
      })
    )

const emitDeniedAudit = (
  options: CrashReporterServiceOptions,
  method: (typeof CrashReporterMethodNames)[number],
  error: PermissionDeniedError
): Effect.Effect<void, never, never> =>
  emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-denied",
      source: operation(method),
      traceId: error.traceId,
      outcome: "denied",
      normalizedCapability: P.nativeInvoke({ primitive: Surface, methods: [method] }),
      actor: CrashReporterActor,
      resource: "crash-reporter",
      details: { reason: error.reason }
    })
  ).pipe(Effect.ignore)

const emitUseAudit = (
  options: CrashReporterServiceOptions,
  method: (typeof CrashReporterMethodNames)[number],
  details: Record<string, unknown> = {}
): Effect.Effect<void, CrashReporterError, never> =>
  emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-used",
      source: operation(method),
      traceId: operation(method),
      outcome: "used",
      normalizedCapability: P.nativeInvoke({ primitive: Surface, methods: [method] }),
      actor: CrashReporterActor,
      resource: "crash-reporter",
      details
    })
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInternalError(
        `failed to write crash reporter audit event: ${error.message}`,
        operation(method)
      )
    )
  )

const emitFailureAudit = (
  options: CrashReporterServiceOptions,
  method: (typeof CrashReporterMethodNames)[number],
  error: CrashReporterError
): Effect.Effect<void, never, never> =>
  emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-used",
      source: operation(method),
      traceId: operation(method),
      outcome: "failed",
      normalizedCapability: P.nativeInvoke({ primitive: Surface, methods: [method] }),
      actor: CrashReporterActor,
      resource: "crash-reporter",
      details: { reason: error.tag, operation: error.operation }
    })
  ).pipe(Effect.ignore)

const operation = (method: (typeof CrashReporterMethodNames)[number]): string =>
  `${Surface}.${method}`

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
