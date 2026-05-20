import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  type HostProtocolError,
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
  permissionAuditEvent
} from "@effect-desktop/core"
import { Clock, Context, Effect, Layer, Schema, Stream } from "effect"

import {
  FocusedApplicationContextActor,
  FocusedApplicationContextEvent,
  FocusedApplicationContextSnapshotInput,
  FocusedApplicationContextSnapshotRequest,
  FocusedApplicationContextSnapshotResult,
  FocusedApplicationContextSupportedResult,
  FocusedApplicationMetadata,
  FocusedDisplayMetadata,
  FocusedWindowMetadata
} from "./contracts/focused-application-context.js"
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
})

export type FocusedApplicationContextError = HostProtocolError

export const FocusedApplicationContextSnapshot = NativeSurface.rpc(Surface, "snapshot", {
  payload: FocusedApplicationContextSnapshotInput,
  success: FocusedApplicationContextSnapshotResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["snapshot"] })
  ),
  endpoint: "query",
  support: SnapshotSupport
})
export const FocusedApplicationContextIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: FocusedApplicationContextSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const focusedApplicationContextCapabilityFact = (method: "watch" | "stopWatching") =>
  NativeSurface.capabilityFact(Surface, method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: [method] })
    ),
    support: UnsupportedSupport
  })

export const FocusedApplicationContextCapabilityFacts = Object.freeze([
  focusedApplicationContextCapabilityFact("watch"),
  focusedApplicationContextCapabilityFact("stopWatching")
])

export const FocusedApplicationContextRpcEvents = Object.freeze({
  Event: { payload: FocusedApplicationContextEvent }
})

const FocusedApplicationContextRpcGroup = RpcGroup.make(
  FocusedApplicationContextSnapshot,
  FocusedApplicationContextIsSupported
)

export const FocusedApplicationContextRpcs: RpcGroup.RpcGroup<FocusedApplicationContextRpc> =
  FocusedApplicationContextRpcGroup

export const FocusedApplicationContextMethodNames = Object.freeze([
  "snapshot",
  "isSupported"
] as const)

export interface FocusedApplicationContextClientApi {
  readonly snapshot: (
    input: FocusedApplicationContextSnapshotInput
  ) => Effect.Effect<FocusedApplicationContextSnapshotResult, FocusedApplicationContextError, never>
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
      return makeFocusedApplicationContextService(client, { permissions, resources })
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
  Layer.succeed(FocusedApplicationContext)(makeFocusedApplicationContextService(client, options))

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
    handlers: FocusedApplicationContextHandlersLive,
    capabilityFacts: FocusedApplicationContextCapabilityFacts,
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
  readonly failure?: Partial<Record<"snapshot", FocusedApplicationContextError>>
}

export const makeFocusedApplicationContextMemoryClient = (
  options: FocusedApplicationContextMemoryClientOptions = {}
): Effect.Effect<FocusedApplicationContextClientApi, never, never> =>
  Effect.succeed(
    Object.freeze({
      snapshot: (input) =>
        validateSnapshotInput(input).pipe(
          Effect.flatMap((valid) => failOr(options.failure?.snapshot, snapshotResult(valid)))
        ),
      isSupported: () =>
        Effect.succeed(new FocusedApplicationContextSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies FocusedApplicationContextClientApi)
  )

export const makeFocusedApplicationContextUnsupportedClient =
  (): FocusedApplicationContextClientApi =>
    Object.freeze({
      snapshot: (input) =>
        validateSnapshotInput(input).pipe(
          Effect.flatMap(() => Effect.fail(unsupportedError("FocusedApplicationContext.snapshot")))
        ),
      isSupported: () =>
        Effect.succeed(
          new FocusedApplicationContextSupportedResult({
            supported: false,
            reason: UnsupportedReason
          })
        ),
      events: () => Stream.fail(unsupportedError(FocusedApplicationContextEventMethod))
    } satisfies FocusedApplicationContextClientApi)

const makeFocusedApplicationContextService = (
  client: FocusedApplicationContextClientApi,
  options: FocusedApplicationContextServiceOptions
): FocusedApplicationContextServiceApi =>
  Object.freeze({
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
    isSupported: () => client.isSupported(),
    events: () => client.events()
  } satisfies FocusedApplicationContextServiceApi)

const focusedApplicationContextClientFromRpcClient = (
  client: DesktopRpcClient<FocusedApplicationContextRpc>,
  _exchange: BridgeClientExchange | undefined
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
    isSupported: () =>
      runFocusedApplicationContextRpc(
        client["FocusedApplicationContext.isSupported"](undefined),
        "FocusedApplicationContext.isSupported"
      ),
    events: () => Stream.fail(unsupportedError(FocusedApplicationContextEventMethod))
  } satisfies FocusedApplicationContextClientApi)

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

const authorize = (
  options: FocusedApplicationContextServiceOptions,
  actor: FocusedApplicationContextActor,
  method: "snapshot",
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

const capability = (method: "snapshot"): NormalizedCapability =>
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
