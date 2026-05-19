import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  type HostProtocolError,
  type RpcCapabilityMetadata,
  type RpcSupportMetadata,
  RpcGroup
} from "@effect-desktop/bridge"
import {
  type AuditEventsApi,
  type DesktopRpcClient,
  emitAuditEvent,
  type NormalizedCapability,
  P,
  PermissionActor,
  PermissionContext,
  PermissionDeniedError,
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError,
  ResourceRegistry,
  type ResourceRegistryApi,
  makeResourceId,
  permissionAuditEvent
} from "@effect-desktop/core"
import { Clock, Context, Effect, Layer, PubSub, Ref, Schema, Stream } from "effect"

import {
  FocusedApplicationContextActor,
  FocusedApplicationContextEvent,
  FocusedApplicationContextSnapshotInput,
  FocusedApplicationContextSnapshotRequest,
  FocusedApplicationContextSnapshotResult,
  FocusedApplicationContextStopWatchingInput,
  FocusedApplicationContextStopWatchingRequest,
  FocusedApplicationContextStopWatchingResult,
  FocusedApplicationContextSupportedResult,
  FocusedApplicationContextWatchInput,
  FocusedApplicationContextWatchRequest,
  FocusedApplicationContextWatchResult,
  FocusedApplicationMetadata,
  FocusedDisplayMetadata,
  FocusedWindowMetadata
} from "./contracts/focused-application-context.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/focused-application-context.js"

const Surface = "FocusedApplicationContext"
const UnsupportedReason = "host-adapter-unimplemented"
const MacOsSnapshotReason = "macos-frontmost-application-only"
const FocusedApplicationContextEventMethod = "FocusedApplicationContext.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})
const SnapshotSupport = NativeSurface.support.partial(MacOsSnapshotReason, {
  platforms: [
    { platform: "macos", status: "partial", reason: MacOsSnapshotReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
}) satisfies RpcSupportMetadata

export type FocusedApplicationContextError = HostProtocolError

export const FocusedApplicationContextSnapshot = focusedApplicationContextRpc(
  "snapshot",
  FocusedApplicationContextSnapshotInput,
  FocusedApplicationContextSnapshotResult,
  P.nativeInvoke({ primitive: Surface, methods: ["snapshot"] }),
  SnapshotSupport
)
export const FocusedApplicationContextWatch = focusedApplicationContextRpc(
  "watch",
  FocusedApplicationContextWatchInput,
  FocusedApplicationContextWatchResult,
  P.nativeInvoke({ primitive: Surface, methods: ["watch"] })
)
export const FocusedApplicationContextStopWatching = focusedApplicationContextRpc(
  "stopWatching",
  FocusedApplicationContextStopWatchingInput,
  FocusedApplicationContextStopWatchingResult,
  P.nativeInvoke({ primitive: Surface, methods: ["stopWatching"] })
)
export const FocusedApplicationContextIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: FocusedApplicationContextSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const FocusedApplicationContextRpcEvents = Object.freeze({
  Event: { payload: FocusedApplicationContextEvent }
})

const FocusedApplicationContextRpcGroup = RpcGroup.make(
  FocusedApplicationContextSnapshot,
  FocusedApplicationContextWatch,
  FocusedApplicationContextStopWatching,
  FocusedApplicationContextIsSupported
)

export const FocusedApplicationContextRpcs: RpcGroup.RpcGroup<FocusedApplicationContextRpc> =
  FocusedApplicationContextRpcGroup

export const FocusedApplicationContextMethodNames = Object.freeze([
  "snapshot",
  "watch",
  "stopWatching",
  "isSupported"
] as const)

const FocusedApplicationContextCapabilityMethods = Object.freeze([
  "snapshot",
  "watch",
  "stopWatching"
] as const satisfies readonly (typeof FocusedApplicationContextMethodNames)[number][])

export interface FocusedApplicationContextClientApi {
  readonly snapshot: (
    input: FocusedApplicationContextSnapshotInput
  ) => Effect.Effect<FocusedApplicationContextSnapshotResult, FocusedApplicationContextError, never>
  readonly watch: (
    input: FocusedApplicationContextWatchInput
  ) => Effect.Effect<FocusedApplicationContextWatchResult, FocusedApplicationContextError, never>
  readonly stopWatching: (
    input: FocusedApplicationContextStopWatchingInput
  ) => Effect.Effect<
    FocusedApplicationContextStopWatchingResult,
    FocusedApplicationContextError,
    never
  >
  readonly isSupported: () => Effect.Effect<
    FocusedApplicationContextSupportedResult,
    FocusedApplicationContextError,
    never
  >
  readonly events: () => Stream.Stream<
    FocusedApplicationContextEvent,
    FocusedApplicationContextError,
    never
  >
}

export class FocusedApplicationContextClient extends Context.Service<
  FocusedApplicationContextClient,
  FocusedApplicationContextClientApi
>()("@effect-desktop/native/FocusedApplicationContextClient") {}

export interface FocusedApplicationContextServiceApi {
  readonly snapshot: (
    input: FocusedApplicationContextSnapshotRequest
  ) => Effect.Effect<FocusedApplicationContextSnapshotResult, FocusedApplicationContextError, never>
  readonly watch: (
    input: FocusedApplicationContextWatchRequest
  ) => Effect.Effect<FocusedApplicationContextWatchResult, FocusedApplicationContextError, never>
  readonly stopWatching: (
    input: FocusedApplicationContextStopWatchingRequest
  ) => Effect.Effect<
    FocusedApplicationContextStopWatchingResult,
    FocusedApplicationContextError,
    never
  >
  readonly isSupported: () => Effect.Effect<
    FocusedApplicationContextSupportedResult,
    FocusedApplicationContextError,
    never
  >
  readonly events: () => Stream.Stream<
    FocusedApplicationContextEvent,
    FocusedApplicationContextError,
    never
  >
}

export interface FocusedApplicationContextServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly audit?: AuditEventsApi
  readonly resources: ResourceRegistryApi
  readonly nextWatchId?: () => string
  readonly nextTraceId?: () => string
}

export class FocusedApplicationContext extends Context.Service<
  FocusedApplicationContext,
  FocusedApplicationContextServiceApi
>()("@effect-desktop/native/FocusedApplicationContext") {
  static readonly layer = Layer.effect(FocusedApplicationContext)(
    Effect.gen(function* () {
      const client = yield* FocusedApplicationContextClient
      const permissions = yield* PermissionRegistry
      const resources = yield* ResourceRegistry
      return yield* makeFocusedApplicationContextService(client, { permissions, resources })
    })
  )
}

export const FocusedApplicationContextLive = FocusedApplicationContext.layer

export const makeFocusedApplicationContextClientLayer = (
  client: FocusedApplicationContextClientApi
): Layer.Layer<FocusedApplicationContextClient> =>
  Layer.succeed(FocusedApplicationContextClient)(client)

export const makeFocusedApplicationContextServiceLayer = (
  client: FocusedApplicationContextClientApi,
  options: FocusedApplicationContextServiceOptions
): Layer.Layer<FocusedApplicationContext> =>
  Layer.effect(FocusedApplicationContext)(makeFocusedApplicationContextService(client, options))

export const makeFocusedApplicationContextBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<FocusedApplicationContextClient> =>
  FocusedApplicationContextSurface.bridgeClientLayer(exchange, options)

export type FocusedApplicationContextRpc = RpcGroup.Rpcs<typeof FocusedApplicationContextRpcGroup>
export type FocusedApplicationContextRpcHandlers =
  RpcGroup.HandlersFrom<FocusedApplicationContextRpc>

export const FocusedApplicationContextHandlersLive = FocusedApplicationContextRpcGroup.toLayer({
  "FocusedApplicationContext.snapshot": (input) =>
    Effect.gen(function* () {
      const service = yield* FocusedApplicationContext
      return yield* service.snapshot(input)
    }),
  "FocusedApplicationContext.watch": (input) =>
    Effect.gen(function* () {
      const service = yield* FocusedApplicationContext
      return yield* service.watch(input)
    }),
  "FocusedApplicationContext.stopWatching": (input) =>
    Effect.gen(function* () {
      const service = yield* FocusedApplicationContext
      return yield* service.stopWatching(input)
    }),
  "FocusedApplicationContext.isSupported": () =>
    Effect.gen(function* () {
      const service = yield* FocusedApplicationContext
      return yield* service.isSupported()
    })
})

export const FocusedApplicationContextSurface = NativeSurface.make(
  Surface,
  FocusedApplicationContextRpcGroup,
  {
    service: FocusedApplicationContextClient,
    capabilities: FocusedApplicationContextCapabilityMethods,
    handlers: FocusedApplicationContextHandlersLive,
    client: (client) => focusedApplicationContextClientFromRpcClient(client, undefined),
    bridgeClient: (client, exchange) =>
      focusedApplicationContextClientFromRpcClient(client, exchange)
  }
)

export const makeHostFocusedApplicationContextRpcRuntime = (
  handlers: FocusedApplicationContextRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  FocusedApplicationContextSurface.hostRuntime(handlers, runtimeOptions)

export interface FocusedApplicationContextMemoryClientOptions {
  readonly failure?: Partial<
    Record<"snapshot" | "watch" | "stopWatching", FocusedApplicationContextError>
  >
  readonly nextWatchId?: () => string
}

export const makeFocusedApplicationContextMemoryClient = (
  options: FocusedApplicationContextMemoryClientOptions = {}
): Effect.Effect<FocusedApplicationContextClientApi, never, never> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.bounded<FocusedApplicationContextEvent>({
      capacity: 256,
      replay: 64
    })
    const nextWatchId = yield* makeIdGenerator(options.nextWatchId, "focused-app-watch")
    const activeWatches = yield* Ref.make<ReadonlySet<string>>(new Set())

    return Object.freeze({
      snapshot: (input) =>
        validateSnapshotInput(input).pipe(
          Effect.flatMap((valid) => failOr(options.failure?.snapshot, snapshotResult(valid)))
        ),
      watch: (input) =>
        validateWatchInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.watch,
              Effect.gen(function* () {
                const watchId = valid.watchId ?? (yield* nextWatchId())
                yield* Ref.update(activeWatches, (current) => new Set(current).add(watchId))
                yield* publishEvent(pubsub, "watch-started", watchId)
                return new FocusedApplicationContextWatchResult({ watchId, active: true })
              })
            )
          )
        ),
      stopWatching: (input) =>
        validateStopWatchingInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.stopWatching,
              Effect.gen(function* () {
                const stopped = yield* Ref.modify(activeWatches, (current) => {
                  const next = new Set(current)
                  const deleted = next.delete(valid.watchId)
                  return [deleted, next] as const
                })
                if (stopped) {
                  yield* publishEvent(pubsub, "watch-stopped", valid.watchId)
                }
                return new FocusedApplicationContextStopWatchingResult({
                  watchId: valid.watchId,
                  stopped
                })
              })
            )
          )
        ),
      isSupported: () =>
        Effect.succeed(new FocusedApplicationContextSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(pubsub)
    } satisfies FocusedApplicationContextClientApi)
  })

export const makeFocusedApplicationContextUnsupportedClient =
  (): FocusedApplicationContextClientApi =>
    Object.freeze({
      snapshot: (input) =>
        validateSnapshotInput(input).pipe(
          Effect.flatMap(() => Effect.fail(unsupportedError("FocusedApplicationContext.snapshot")))
        ),
      watch: (input) =>
        validateWatchInput(input).pipe(
          Effect.flatMap(() => Effect.fail(unsupportedError("FocusedApplicationContext.watch")))
        ),
      stopWatching: (input) =>
        validateStopWatchingInput(input).pipe(
          Effect.flatMap(() =>
            Effect.fail(unsupportedError("FocusedApplicationContext.stopWatching"))
          )
        ),
      isSupported: () =>
        Effect.succeed(
          new FocusedApplicationContextSupportedResult({
            supported: false,
            reason: UnsupportedReason
          })
        ),
      events: () => Stream.fail(unsupportedError("FocusedApplicationContext.events"))
    } satisfies FocusedApplicationContextClientApi)

const makeFocusedApplicationContextService = (
  client: FocusedApplicationContextClientApi,
  options: FocusedApplicationContextServiceOptions
): Effect.Effect<FocusedApplicationContextServiceApi, never, never> =>
  Effect.gen(function* () {
    const nextWatchId = yield* makeIdGenerator(options.nextWatchId, "focused-app-watch")

    return Object.freeze({
      snapshot: (input) =>
        Effect.gen(function* () {
          const request = yield* validateSnapshotRequest(input)
          yield* authorize(options, request.actor, "snapshot", request.traceId)
          const result = yield* auditFailure(
            options,
            capability("snapshot"),
            request.actor,
            "FocusedApplicationContext.snapshot",
            request.traceId ?? "FocusedApplicationContext.snapshot",
            client.snapshot(new FocusedApplicationContextSnapshotInput({ actor: request.actor }))
          )
          yield* emitContextAudit(
            options,
            "permission-used",
            capability("snapshot"),
            request.actor,
            "FocusedApplicationContext.snapshot",
            request.traceId ?? "FocusedApplicationContext.snapshot"
          )
          return result
        }),
      watch: (input) =>
        Effect.gen(function* () {
          const request = yield* validateWatchRequest(input)
          const watchId = request.watchId ?? (yield* nextWatchId())
          yield* authorize(options, request.actor, "watch", request.traceId)
          const registeredResult = new FocusedApplicationContextWatchResult({
            watchId,
            active: true
          })
          yield* registerWatchResource(options, client, request, registeredResult)
          const result = yield* auditFailure(
            options,
            capability("watch"),
            request.actor,
            "FocusedApplicationContext.watch",
            request.traceId ?? watchId,
            client.watch(
              new FocusedApplicationContextWatchInput({
                actor: request.actor,
                watchId,
                ...(request.ownerScope === undefined ? {} : { ownerScope: request.ownerScope })
              })
            )
          ).pipe(
            Effect.tapError(() => disposeWatchResource(options, watchId)),
            Effect.flatMap((result) =>
              result.watchId === watchId
                ? Effect.succeed(result)
                : disposeWatchResource(options, watchId).pipe(
                    Effect.andThen(
                      Effect.fail(
                        makeHostProtocolInternalError(
                          `focused application context watch returned mismatched watch id: ${result.watchId}`,
                          "FocusedApplicationContext.watch"
                        )
                      )
                    )
                  )
            )
          )
          yield* emitContextAudit(
            options,
            "permission-used",
            capability("watch"),
            request.actor,
            "FocusedApplicationContext.watch",
            request.traceId ?? result.watchId
          )
          return result
        }),
      stopWatching: (input) =>
        Effect.gen(function* () {
          const request = yield* validateStopWatchingRequest(input)
          yield* authorize(options, request.actor, "stopWatching", request.traceId)
          const result = yield* auditFailure(
            options,
            capability("stopWatching"),
            request.actor,
            "FocusedApplicationContext.stopWatching",
            request.traceId ?? request.watchId,
            client.stopWatching(
              new FocusedApplicationContextStopWatchingInput({
                actor: request.actor,
                watchId: request.watchId
              })
            )
          )
          yield* disposeWatchResource(options, result.watchId)
          yield* emitContextAudit(
            options,
            "permission-used",
            capability("stopWatching"),
            request.actor,
            "FocusedApplicationContext.stopWatching",
            request.traceId ?? result.watchId
          )
          return result
        }),
      isSupported: () => client.isSupported(),
      events: () => client.events()
    } satisfies FocusedApplicationContextServiceApi)
  })

const focusedApplicationContextClientFromRpcClient = (
  client: DesktopRpcClient<FocusedApplicationContextRpc>,
  exchange: BridgeClientExchange | undefined
): FocusedApplicationContextClientApi =>
  Object.freeze({
    snapshot: (input) =>
      validateSnapshotInput(input).pipe(
        Effect.flatMap((valid) =>
          runFocusedApplicationContextRpc(
            client["FocusedApplicationContext.snapshot"](valid),
            "FocusedApplicationContext.snapshot"
          )
        )
      ),
    watch: (input) =>
      validateWatchInput(input).pipe(
        Effect.flatMap((valid) =>
          runFocusedApplicationContextRpc(
            client["FocusedApplicationContext.watch"](valid),
            "FocusedApplicationContext.watch"
          )
        )
      ),
    stopWatching: (input) =>
      validateStopWatchingInput(input).pipe(
        Effect.flatMap((valid) =>
          runFocusedApplicationContextRpc(
            client["FocusedApplicationContext.stopWatching"](valid),
            "FocusedApplicationContext.stopWatching"
          )
        )
      ),
    isSupported: () =>
      runFocusedApplicationContextRpc(
        client["FocusedApplicationContext.isSupported"](undefined),
        "FocusedApplicationContext.isSupported"
      ),
    events: () =>
      subscribeNativeEvent(
        exchange,
        FocusedApplicationContextEventMethod,
        FocusedApplicationContextEvent
      )
  } satisfies FocusedApplicationContextClientApi)

function focusedApplicationContextRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(
  method: Method,
  payload: Payload,
  success: Success,
  cap: RpcCapabilityMetadata,
  support: RpcSupportMetadata = UnsupportedSupport
) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(cap),
    endpoint: method === "snapshot" ? "query" : "mutation",
    support
  })
}

const runFocusedApplicationContextRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, FocusedApplicationContextError, never> =>
  runNativeRpc(effect, operation, Surface)

const validateSnapshotRequest = (input: unknown) =>
  decodeNativeInput(
    FocusedApplicationContextSnapshotRequest,
    input,
    "FocusedApplicationContext.snapshot"
  )
const validateSnapshotInput = (input: unknown) =>
  decodeNativeInput(
    FocusedApplicationContextSnapshotInput,
    input,
    "FocusedApplicationContext.snapshot"
  )
const validateWatchRequest = (input: unknown) =>
  decodeNativeInput(FocusedApplicationContextWatchRequest, input, "FocusedApplicationContext.watch")
const validateWatchInput = (input: unknown) =>
  decodeNativeInput(FocusedApplicationContextWatchInput, input, "FocusedApplicationContext.watch")
const validateStopWatchingRequest = (input: unknown) =>
  decodeNativeInput(
    FocusedApplicationContextStopWatchingRequest,
    input,
    "FocusedApplicationContext.stopWatching"
  )
const validateStopWatchingInput = (input: unknown) =>
  decodeNativeInput(
    FocusedApplicationContextStopWatchingInput,
    input,
    "FocusedApplicationContext.stopWatching"
  )

const authorize = (
  options: FocusedApplicationContextServiceOptions,
  actor: FocusedApplicationContextActor,
  method: "snapshot" | "watch" | "stopWatching",
  traceId: string | undefined
): Effect.Effect<void, FocusedApplicationContextError, never> =>
  options.permissions
    .check(
      capability(method),
      new PermissionContext({
        actor: permissionActor(actor),
        resource: "focused-application",
        traceId: traceId ?? options.nextTraceId?.() ?? `FocusedApplicationContext.${method}`
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: PermissionRegistryError) => {
        if (!(error instanceof PermissionDeniedError)) {
          return Effect.fail(
            makeHostProtocolInternalError(
              `focused application context permission registry failure: ${error._tag}`,
              `FocusedApplicationContext.${method}`
            )
          )
        }
        return emitContextAudit(
          options,
          "permission-denied",
          capability(method),
          actor,
          `FocusedApplicationContext.${method}`,
          error.traceId,
          { reason: error.reason }
        ).pipe(
          Effect.andThen(
            Effect.fail(
              permissionDeniedError(
                capability(method),
                error,
                `FocusedApplicationContext.${method}`
              )
            )
          )
        )
      })
    )

const capability = (method: "snapshot" | "watch" | "stopWatching"): NormalizedCapability =>
  P.nativeInvoke({ primitive: Surface, methods: [method] })

const snapshotResult = (
  _input: FocusedApplicationContextSnapshotInput
): Effect.Effect<FocusedApplicationContextSnapshotResult, never, never> =>
  Clock.currentTimeMillis.pipe(
    Effect.map(
      (observedAt) =>
        new FocusedApplicationContextSnapshotResult({
          application: new FocusedApplicationMetadata({
            applicationId: "memory-app",
            name: "Memory App",
            bundleId: "dev.effect.memory-app",
            processId: 42
          }),
          window: new FocusedWindowMetadata({
            windowId: "memory-window",
            title: "Memory Window",
            displayId: "display-1"
          }),
          display: new FocusedDisplayMetadata({ displayId: "display-1", scaleFactor: 2 }),
          observedAt
        })
    )
  )

const auditFailure = <A>(
  options: FocusedApplicationContextServiceOptions,
  cap: NormalizedCapability,
  actor: FocusedApplicationContextActor,
  operation: string,
  traceId: string,
  effect: Effect.Effect<A, FocusedApplicationContextError, never>
): Effect.Effect<A, FocusedApplicationContextError, never> =>
  effect.pipe(
    Effect.tapError((error) =>
      emitContextAudit(options, "permission-used", cap, actor, operation, traceId, {
        outcome: "failed",
        reason: error.tag
      })
    )
  )

const registerWatchResource = (
  options: FocusedApplicationContextServiceOptions,
  client: FocusedApplicationContextClientApi,
  request: FocusedApplicationContextWatchRequest,
  result: FocusedApplicationContextWatchResult
): Effect.Effect<void, FocusedApplicationContextError, never> => {
  const traceId = request.traceId ?? result.watchId
  return options.resources
    .register({
      kind: "focused-application-context-watch",
      id: makeResourceId(`focused-application-context-${result.watchId}`),
      ownerScope: request.ownerScope ?? `${request.actor.kind}:${request.actor.id}`,
      state: result.active ? "active" : "closed",
      reusableId: true,
      dispose: client
        .stopWatching(
          new FocusedApplicationContextStopWatchingInput({
            actor: request.actor,
            watchId: result.watchId,
            traceId
          })
        )
        .pipe(
          Effect.andThen(
            emitContextAudit(
              options,
              "permission-used",
              capability("stopWatching"),
              request.actor,
              "FocusedApplicationContext.stopWatching",
              traceId,
              { outcome: "released-by-scope", watchId: result.watchId }
            )
          ),
          Effect.ignore
        )
    })
    .pipe(
      Effect.asVoid,
      Effect.mapError((error) =>
        makeHostProtocolInternalError(
          `failed to register focused application context watch resource: ${error.message}`,
          "FocusedApplicationContext.watch"
        )
      )
    )
}

const disposeWatchResource = (
  options: FocusedApplicationContextServiceOptions,
  watchId: string
): Effect.Effect<void, never, never> =>
  options.resources.dispose(makeResourceId(`focused-application-context-${watchId}`))

const publishEvent = (
  pubsub: PubSub.PubSub<FocusedApplicationContextEvent>,
  phase: "watch-started" | "watch-stopped" | "focus-changed" | "failed",
  watchId?: string
): Effect.Effect<void, never, never> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((timestamp) =>
      PubSub.publish(
        pubsub,
        new FocusedApplicationContextEvent({
          type: "focused-application-context-event",
          timestamp,
          phase,
          ...(watchId === undefined ? {} : { watchId })
        })
      )
    ),
    Effect.asVoid
  )

const emitContextAudit = (
  options: FocusedApplicationContextServiceOptions,
  kind: "permission-used" | "permission-denied",
  cap: NormalizedCapability,
  actor: FocusedApplicationContextActor,
  operation: string,
  traceId: string,
  details: Record<string, unknown> = {}
): Effect.Effect<void, FocusedApplicationContextError, never> => {
  if (options.audit === undefined) {
    return Effect.void
  }
  return emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind,
      source: operation,
      traceId,
      outcome:
        typeof details["outcome"] === "string"
          ? details["outcome"]
          : kind === "permission-denied"
            ? "denied"
            : "used",
      normalizedCapability: cap,
      actor: permissionActor(actor),
      resource: "focused-application",
      details: { surface: "focused-application", ...details }
    })
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInternalError(
        `failed to write focused application context audit event: ${error.message}`,
        operation
      )
    )
  )
}

const permissionActor = (actor: FocusedApplicationContextActor): PermissionActor =>
  new PermissionActor({
    kind:
      actor.kind === "app" || actor.kind === "window" || actor.kind === "process"
        ? actor.kind
        : "resource",
    id:
      actor.kind === "app" || actor.kind === "window" || actor.kind === "process"
        ? actor.id
        : `${actor.kind}:${actor.id}`
  })

const permissionDeniedError = (
  cap: NormalizedCapability,
  error: PermissionDeniedError,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    message: `permission denied for ${cap.kind}`,
    operation,
    capability: cap.kind,
    resource: error.traceId,
    recoverable: false
  })

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported FocusedApplicationContext method: ${operation}`,
    operation,
    recoverable: false
  })

const failOr = <A>(
  error: FocusedApplicationContextError | undefined,
  effect: Effect.Effect<A, FocusedApplicationContextError, never>
): Effect.Effect<A, FocusedApplicationContextError, never> =>
  error === undefined ? effect : Effect.fail(error)

const makeIdGenerator = (
  next: (() => string) | undefined,
  prefix: string
): Effect.Effect<() => Effect.Effect<string, never, never>, never, never> =>
  Effect.gen(function* () {
    const counter = yield* Ref.make(0)
    return () =>
      next === undefined
        ? Ref.modify(counter, (current) => [`${prefix}-${current + 1}`, current + 1] as const)
        : Effect.sync(next)
  })
