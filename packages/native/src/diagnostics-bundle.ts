import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidStateError,
  redactForJsonWithEvidence,
  type HostProtocolError,
  type RpcCapabilityMetadata,
  RpcGroup
} from "@orika/bridge"
import {
  type AuditEventsApi,
  type DesktopRpcClient,
  emitAuditEvent,
  P,
  PermissionActor,
  type PermissionRegistry,
  permissionAuditEvent
} from "@orika/core"
import { Clock, Context, Effect, Layer, PubSub, Ref, Schema, Stream } from "effect"

import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import {
  DiagnosticsBundleCollectInput,
  DiagnosticsBundleCollectResult,
  DiagnosticsBundleCollectStartedEvent,
  type DiagnosticsBundleEvent,
  DiagnosticsBundleFailedEvent,
  type DiagnosticsBundleFailureReason,
  DiagnosticsBundleIdentity,
  DiagnosticsBundleRedactInput,
  DiagnosticsBundleRedactResult,
  DiagnosticsBundleRedactionEvidence,
  DiagnosticsBundleRedactionPolicy,
  DiagnosticsBundleSourceRedactedEvent,
  DiagnosticsBundleSourceSummary,
  DiagnosticsBundleSupportedResult,
  DiagnosticsBundleWriteCompletedEvent,
  DiagnosticsBundleWriteInput,
  DiagnosticsBundleWriteResult,
  type DiagnosticsBundleSourceKind
} from "./contracts/diagnostics-bundle.js"

const Surface = "DiagnosticsBundle"
const UnsupportedReason = "host-adapter-unimplemented"
const DefaultRedactionPolicyId = "default-secret-patterns"
const DefaultSources = Object.freeze([
  "logs",
  "traces",
  "crash-reports",
  "host-state",
  "extension-health",
  "audit-events"
] as const satisfies readonly DiagnosticsBundleSourceKind[])
const DiagnosticsActor = new PermissionActor({ kind: "app", id: "diagnostics-bundle" })

export type DiagnosticsBundleError = HostProtocolError

export const DiagnosticsBundleCollect = diagnosticsBundleRpc(
  "collect",
  DiagnosticsBundleCollectInput,
  DiagnosticsBundleCollectResult,
  P.nativeInvoke({ primitive: Surface, methods: ["collect"] })
)
export const DiagnosticsBundleRedact = diagnosticsBundleRpc(
  "redact",
  DiagnosticsBundleRedactInput,
  DiagnosticsBundleRedactResult,
  P.nativeInvoke({ primitive: Surface, methods: ["redact"] })
)
export const DiagnosticsBundleWrite = diagnosticsBundleRpc(
  "write",
  DiagnosticsBundleWriteInput,
  DiagnosticsBundleWriteResult,
  P.nativeInvoke({ primitive: Surface, methods: ["write"] })
)
export const DiagnosticsBundleIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: DiagnosticsBundleSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const DiagnosticsBundleRpcEvents = Object.freeze({
  CollectStarted: { payload: DiagnosticsBundleCollectStartedEvent },
  SourceRedacted: { payload: DiagnosticsBundleSourceRedactedEvent },
  WriteCompleted: { payload: DiagnosticsBundleWriteCompletedEvent },
  Failed: { payload: DiagnosticsBundleFailedEvent }
})

export type DiagnosticsBundleRpcEvents = typeof DiagnosticsBundleRpcEvents

const DiagnosticsBundleRpcGroup = RpcGroup.make(
  DiagnosticsBundleCollect,
  DiagnosticsBundleRedact,
  DiagnosticsBundleWrite,
  DiagnosticsBundleIsSupported
)

export const DiagnosticsBundleRpcs: RpcGroup.RpcGroup<DiagnosticsBundleRpc> =
  DiagnosticsBundleRpcGroup

export const DiagnosticsBundleMethodNames = Object.freeze([
  "collect",
  "redact",
  "write",
  "isSupported"
] as const)

const DiagnosticsBundleCapabilityMethods = Object.freeze([
  "collect",
  "redact",
  "write"
] as const satisfies readonly (typeof DiagnosticsBundleMethodNames)[number][])

export interface DiagnosticsBundleClientApi {
  readonly collect: (
    input?: DiagnosticsBundleCollectInput
  ) => Effect.Effect<DiagnosticsBundleCollectResult, DiagnosticsBundleError, never>
  readonly redact: (
    input: DiagnosticsBundleRedactInput
  ) => Effect.Effect<DiagnosticsBundleRedactResult, DiagnosticsBundleError, never>
  readonly write: (
    input: DiagnosticsBundleWriteInput
  ) => Effect.Effect<DiagnosticsBundleWriteResult, DiagnosticsBundleError, never>
  readonly isSupported: () => Effect.Effect<
    DiagnosticsBundleSupportedResult,
    DiagnosticsBundleError,
    never
  >
  readonly events: (
    input: DiagnosticsBundleIdentity
  ) => Stream.Stream<DiagnosticsBundleEvent, DiagnosticsBundleError, never>
}

export class DiagnosticsBundleClient extends Context.Service<
  DiagnosticsBundleClient,
  DiagnosticsBundleClientApi
>()("@orika/native/DiagnosticsBundleClient") {}

export type DiagnosticsBundleServiceApi = DiagnosticsBundleClientApi

export interface DiagnosticsBundleServiceOptions {
  readonly audit?: AuditEventsApi
  readonly nextTraceId?: () => string
}

export class DiagnosticsBundle extends Context.Service<
  DiagnosticsBundle,
  DiagnosticsBundleServiceApi
>()("@orika/native/DiagnosticsBundle") {
  static readonly layer = Layer.effect(DiagnosticsBundle)(
    Effect.gen(function* () {
      const client = yield* DiagnosticsBundleClient
      return makeDiagnosticsBundleService(client)
    })
  )
}

export const DiagnosticsBundleLive = DiagnosticsBundle.layer

export const makeDiagnosticsBundleClientLayer = (
  client: DiagnosticsBundleClientApi
): Layer.Layer<DiagnosticsBundleClient> => Layer.succeed(DiagnosticsBundleClient)(client)

export const makeDiagnosticsBundleServiceLayer = (
  client: DiagnosticsBundleClientApi,
  options: DiagnosticsBundleServiceOptions = {}
): Layer.Layer<DiagnosticsBundle> =>
  Layer.effect(DiagnosticsBundle)(Effect.succeed(makeDiagnosticsBundleService(client, options)))

export const makeDiagnosticsBundleBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<DiagnosticsBundleClient> =>
  DiagnosticsBundleSurface.bridgeClientLayer(exchange, options)

export type DiagnosticsBundleRpc = RpcGroup.Rpcs<typeof DiagnosticsBundleRpcGroup>

export type DiagnosticsBundleRpcHandlers = RpcGroup.HandlersFrom<DiagnosticsBundleRpc>

export const DiagnosticsBundleHandlersLive = DiagnosticsBundleRpcGroup.toLayer({
  "DiagnosticsBundle.collect": (input) =>
    Effect.gen(function* () {
      const diagnostics = yield* DiagnosticsBundle
      return yield* diagnostics.collect(input)
    }),
  "DiagnosticsBundle.redact": (input) =>
    Effect.gen(function* () {
      const diagnostics = yield* DiagnosticsBundle
      return yield* diagnostics.redact(input)
    }),
  "DiagnosticsBundle.write": (input) =>
    Effect.gen(function* () {
      const diagnostics = yield* DiagnosticsBundle
      return yield* diagnostics.write(input)
    }),
  "DiagnosticsBundle.isSupported": () =>
    Effect.gen(function* () {
      const diagnostics = yield* DiagnosticsBundle
      return yield* diagnostics.isSupported()
    })
})

export const DiagnosticsBundleSurface = NativeSurface.make(Surface, DiagnosticsBundleRpcGroup, {
  service: DiagnosticsBundleClient,
  capabilities: DiagnosticsBundleCapabilityMethods,
  handlers: DiagnosticsBundleHandlersLive,
  client: (client) => diagnosticsBundleClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => diagnosticsBundleClientFromRpcClient(client, exchange)
})

export const makeHostDiagnosticsBundleRpcRuntime = (
  handlers: DiagnosticsBundleRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  DiagnosticsBundleSurface.hostRuntime(handlers, runtimeOptions)

export interface DiagnosticsBundleMemoryClientOptions {
  readonly failure?: Partial<Record<"collect" | "redact" | "write", DiagnosticsBundleError>>
}

export const makeDiagnosticsBundleMemoryClient = (
  options: DiagnosticsBundleMemoryClientOptions = {}
): Effect.Effect<DiagnosticsBundleClientApi, never, never> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.bounded<DiagnosticsBundleEvent>({ capacity: 256, replay: 64 })
    const state = yield* Ref.make<ReadonlyMap<string, DiagnosticsBundleBundleState>>(new Map())

    const publish = (event: DiagnosticsBundleEvent): Effect.Effect<void, never, never> =>
      PubSub.publish(pubsub, event).pipe(Effect.asVoid)

    return Object.freeze({
      collect: (input = new DiagnosticsBundleCollectInput({})) =>
        validateCollectInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.collect,
              Effect.gen(function* () {
                const timestamp = yield* Clock.currentTimeMillis
                const bundleId = valid.bundleId ?? `diagnostics-${timestamp}`
                const sources =
                  valid.sources?.length === 0 ? DefaultSources : (valid.sources ?? DefaultSources)
                const summaries = sources.map((source) => sourceSummary(source, []))
                const result = new DiagnosticsBundleCollectResult({
                  bundleId,
                  collectedAt: timestamp,
                  sources: summaries,
                  artifactCount: summaries.length
                })
                yield* Ref.update(state, (current) =>
                  new Map(current).set(bundleId, { bundleId, sources: summaries })
                )
                yield* publish(
                  new DiagnosticsBundleCollectStartedEvent({
                    type: "collect-started",
                    bundleId,
                    timestamp,
                    sources
                  })
                )
                return result
              })
            )
          )
        ),
      redact: (input) =>
        validateRedactInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.redact,
              Effect.gen(function* () {
                const current = yield* Ref.get(state)
                if (!current.has(valid.bundleId)) {
                  return yield* Effect.fail(
                    makeHostProtocolInvalidStateError(
                      "bundle-not-collected",
                      valid.bundleId,
                      "DiagnosticsBundle.redact"
                    )
                  )
                }
                const redacted = redactForJsonWithEvidence(valid.payload)
                const policy = redactionPolicy(redacted.evidence)
                const result = new DiagnosticsBundleRedactResult({
                  bundleId: valid.bundleId,
                  source: valid.source,
                  payload: redacted.value,
                  redactionPolicy: policy
                })
                yield* Ref.update(state, (current) =>
                  updateBundleSource(current, valid.bundleId, valid.source, policy)
                )
                yield* publish(
                  new DiagnosticsBundleSourceRedactedEvent({
                    type: "source-redacted",
                    bundleId: valid.bundleId,
                    timestamp: yield* Clock.currentTimeMillis,
                    source: valid.source,
                    redactionPolicy: result.redactionPolicy
                  })
                )
                return result
              })
            )
          )
        ),
      write: (input) =>
        validateWriteInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.write,
              Effect.gen(function* () {
                const current = yield* Ref.get(state)
                const bundle = current.get(valid.bundleId)
                if (bundle === undefined) {
                  return yield* Effect.fail(
                    makeHostProtocolInvalidStateError(
                      "bundle-not-collected",
                      valid.bundleId,
                      "DiagnosticsBundle.write"
                    )
                  )
                }
                const bytesWritten = JSON.stringify(bundle).length
                const result = new DiagnosticsBundleWriteResult({
                  bundleId: valid.bundleId,
                  destinationPath: valid.destinationPath,
                  bytesWritten,
                  sources: bundle.sources
                })
                yield* publish(
                  new DiagnosticsBundleWriteCompletedEvent({
                    type: "write-completed",
                    bundleId: valid.bundleId,
                    timestamp: yield* Clock.currentTimeMillis,
                    destinationPath: valid.destinationPath,
                    bytesWritten
                  })
                )
                return result
              })
            )
          )
        ),
      isSupported: () =>
        Effect.succeed(
          new DiagnosticsBundleSupportedResult({
            supported: true
          })
        ),
      events: (input) =>
        Stream.unwrap(
          validateDiagnosticsBundleIdentity(input, "DiagnosticsBundle.events").pipe(
            Effect.map((valid) =>
              Stream.fromPubSub(pubsub).pipe(
                Stream.filter((event) => event.bundleId === valid.bundleId)
              )
            )
          )
        )
    } satisfies DiagnosticsBundleClientApi)
  })

export const makeDiagnosticsBundleUnsupportedClient = (): DiagnosticsBundleClientApi =>
  Object.freeze({
    collect: (input = new DiagnosticsBundleCollectInput({})) =>
      validateCollectInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("DiagnosticsBundle.collect")))
      ),
    redact: (input) =>
      validateRedactInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("DiagnosticsBundle.redact")))
      ),
    write: (input) =>
      validateWriteInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("DiagnosticsBundle.write")))
      ),
    isSupported: () =>
      Effect.succeed(
        new DiagnosticsBundleSupportedResult({
          supported: false,
          reason: UnsupportedReason
        })
      ),
    events: (input) =>
      Stream.unwrap(
        validateDiagnosticsBundleIdentity(input, "DiagnosticsBundle.events").pipe(
          Effect.map(() => Stream.fail(unsupportedError("DiagnosticsBundle.events")))
        )
      )
  } satisfies DiagnosticsBundleClientApi)

export const makeDiagnosticsBundlePermissionDeniedError = (
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability: "native.invoke",
    message: `permission denied for ${operation}`,
    operation,
    recoverable: false
  })

const makeDiagnosticsBundleService = (
  client: DiagnosticsBundleClientApi,
  options: DiagnosticsBundleServiceOptions = {}
): DiagnosticsBundleServiceApi =>
  Object.freeze({
    collect: (input) =>
      withDiagnosticsAudit(
        options,
        "collect",
        () => client.collect(input),
        (result) => ({ bundleId: result.bundleId, artifactCount: result.artifactCount })
      ),
    redact: (input) =>
      withDiagnosticsAudit(
        options,
        "redact",
        () => client.redact(input),
        (result) => ({
          bundleId: result.bundleId,
          source: result.source,
          redactionCount: result.redactionPolicy.evidence.length
        })
      ),
    write: (input) =>
      withDiagnosticsAudit(
        options,
        "write",
        () => client.write(input),
        (result) => ({
          bundleId: result.bundleId,
          destinationPath: result.destinationPath,
          bytesWritten: result.bytesWritten
        })
      ),
    isSupported: () => client.isSupported(),
    events: (input) => client.events(input)
  } satisfies DiagnosticsBundleServiceApi)

const diagnosticsBundleClientFromRpcClient = (
  client: DesktopRpcClient<DiagnosticsBundleRpc>,
  exchange: BridgeClientExchange | undefined
): DiagnosticsBundleClientApi =>
  Object.freeze({
    collect: (input = new DiagnosticsBundleCollectInput({})) =>
      validateCollectInput(input).pipe(
        Effect.flatMap((valid) =>
          runDiagnosticsBundleRpc(
            client["DiagnosticsBundle.collect"](valid),
            "DiagnosticsBundle.collect"
          )
        )
      ),
    redact: (input) =>
      validateRedactInput(input).pipe(
        Effect.flatMap((valid) =>
          runDiagnosticsBundleRpc(
            client["DiagnosticsBundle.redact"](valid),
            "DiagnosticsBundle.redact"
          )
        )
      ),
    write: (input) =>
      validateWriteInput(input).pipe(
        Effect.flatMap((valid) =>
          runDiagnosticsBundleRpc(
            client["DiagnosticsBundle.write"](valid),
            "DiagnosticsBundle.write"
          )
        )
      ),
    isSupported: () =>
      runDiagnosticsBundleRpc(
        client["DiagnosticsBundle.isSupported"](undefined),
        "DiagnosticsBundle.isSupported"
      ),
    events: (input) =>
      Stream.unwrap(
        validateDiagnosticsBundleIdentity(input, "DiagnosticsBundle.events").pipe(
          Effect.map((valid) =>
            subscribeDiagnosticsBundleEvent(exchange).pipe(
              Stream.filter((event) => event.bundleId === valid.bundleId)
            )
          )
        )
      )
  } satisfies DiagnosticsBundleClientApi)

const subscribeDiagnosticsBundleEvent = (
  exchange: BridgeClientExchange | undefined
): Stream.Stream<DiagnosticsBundleEvent, DiagnosticsBundleError, never> => {
  const asEvent = <A extends DiagnosticsBundleEvent>(
    stream: Stream.Stream<A, DiagnosticsBundleError, never>
  ): Stream.Stream<DiagnosticsBundleEvent, DiagnosticsBundleError, never> => stream

  return Stream.mergeAll(
    [
      asEvent(
        subscribeNativeEvent(
          exchange,
          "DiagnosticsBundle.CollectStarted",
          DiagnosticsBundleCollectStartedEvent
        )
      ),
      asEvent(
        subscribeNativeEvent(
          exchange,
          "DiagnosticsBundle.SourceRedacted",
          DiagnosticsBundleSourceRedactedEvent
        )
      ),
      asEvent(
        subscribeNativeEvent(
          exchange,
          "DiagnosticsBundle.WriteCompleted",
          DiagnosticsBundleWriteCompletedEvent
        )
      ),
      asEvent(
        subscribeNativeEvent(exchange, "DiagnosticsBundle.Failed", DiagnosticsBundleFailedEvent)
      )
    ],
    { concurrency: "unbounded" }
  )
}

function diagnosticsBundleRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })
}

const runDiagnosticsBundleRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, DiagnosticsBundleError, never> => runNativeRpc(effect, operation, Surface)

const validateCollectInput = (
  input: unknown
): Effect.Effect<DiagnosticsBundleCollectInput, DiagnosticsBundleError, never> =>
  decodeNativeInput(DiagnosticsBundleCollectInput, input, "DiagnosticsBundle.collect")

const validateRedactInput = (
  input: unknown
): Effect.Effect<DiagnosticsBundleRedactInput, DiagnosticsBundleError, never> =>
  decodeNativeInput(DiagnosticsBundleRedactInput, input, "DiagnosticsBundle.redact")

const validateDiagnosticsBundleIdentity = (
  input: unknown,
  operation: string
): Effect.Effect<DiagnosticsBundleIdentity, DiagnosticsBundleError, never> =>
  decodeNativeInput(DiagnosticsBundleIdentity, input, operation)

const validateWriteInput = (
  input: unknown
): Effect.Effect<DiagnosticsBundleWriteInput, DiagnosticsBundleError, never> =>
  decodeNativeInput(DiagnosticsBundleWriteInput, input, "DiagnosticsBundle.write")

const failOr = <A>(
  error: DiagnosticsBundleError | undefined,
  effect: Effect.Effect<A, DiagnosticsBundleError, never>
): Effect.Effect<A, DiagnosticsBundleError, never> =>
  error === undefined ? effect : Effect.fail(error)

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported DiagnosticsBundle method: ${operation}`,
    operation,
    recoverable: false
  })

interface DiagnosticsBundleBundleState {
  readonly bundleId: string
  readonly sources: readonly DiagnosticsBundleSourceSummary[]
}

const sourceSummary = (
  source: DiagnosticsBundleSourceKind,
  evidence: readonly DiagnosticsBundleRedactionEvidence[]
): DiagnosticsBundleSourceSummary =>
  new DiagnosticsBundleSourceSummary({
    source,
    itemCount: 1,
    redactionPolicy: redactionPolicy(evidence)
  })

const redactionPolicy = (
  evidence: readonly {
    readonly path: string
    readonly action: "redacted"
    readonly reason: "secret-pattern" | "redacted-value"
  }[]
): DiagnosticsBundleRedactionPolicy =>
  new DiagnosticsBundleRedactionPolicy({
    id: DefaultRedactionPolicyId,
    evidence: evidence.map(
      (entry) =>
        new DiagnosticsBundleRedactionEvidence({
          path: entry.path,
          action: entry.action,
          reason: entry.reason
        })
    )
  })

const updateBundleSource = (
  current: ReadonlyMap<string, DiagnosticsBundleBundleState>,
  bundleId: string,
  source: DiagnosticsBundleSourceKind,
  policy: DiagnosticsBundleRedactionPolicy
): ReadonlyMap<string, DiagnosticsBundleBundleState> => {
  const next = new Map(current)
  const previous = next.get(bundleId)
  const sources = previous?.sources ?? []
  const withoutSource = sources.filter((summary) => summary.source !== source)
  next.set(bundleId, {
    bundleId,
    sources: [
      ...withoutSource,
      new DiagnosticsBundleSourceSummary({ source, itemCount: 1, redactionPolicy: policy })
    ]
  })
  return next
}

const withDiagnosticsAudit = <A>(
  options: DiagnosticsBundleServiceOptions,
  method: "collect" | "redact" | "write",
  effect: () => Effect.Effect<A, DiagnosticsBundleError, never>,
  details: (value: A) => unknown
): Effect.Effect<A, DiagnosticsBundleError, never> => {
  const operation = `DiagnosticsBundle.${method}`
  return effect().pipe(
    Effect.tap((value) =>
      emitDiagnosticsAudit(options, method, "success", details(value), operation)
    ),
    Effect.tapError((error) =>
      emitDiagnosticsAudit(
        options,
        method,
        failureReason(error),
        { tag: error.tag, operation: error.operation },
        operation
      )
    )
  )
}

const emitDiagnosticsAudit = (
  options: DiagnosticsBundleServiceOptions,
  method: "collect" | "redact" | "write",
  outcome: string,
  details: unknown,
  operation: string
): Effect.Effect<void, DiagnosticsBundleError, never> => {
  if (options.audit === undefined) {
    return Effect.void
  }

  return emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-used",
      source: operation,
      traceId: options.nextTraceId?.() ?? `${operation}:audit`,
      outcome,
      normalizedCapability: P.nativeInvoke({ primitive: Surface, methods: [method] }),
      actor: DiagnosticsActor,
      details
    })
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInternalError(
        `failed to write diagnostics bundle audit event: ${error.message}`,
        operation
      )
    )
  )
}

const failureReason = (error: DiagnosticsBundleError): DiagnosticsBundleFailureReason => {
  if (error.tag === "PermissionDenied" || error.tag === "PermissionRevoked") {
    return "denied"
  }
  if (error.tag === "Unsupported") {
    return "unsupported"
  }
  if (error.tag === "InvalidArgument" || error.tag === "InvalidState") {
    return "invalid-input"
  }
  return "host-failed"
}
