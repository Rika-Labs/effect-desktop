import {
  type BridgeClientExchange,
  type HostProtocolError,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  type RpcCapabilityMetadata,
  RpcGroup
} from "@orika/bridge"
import {
  type AuditEventsApi,
  type DesktopRpcClient,
  emitAuditEvent,
  makeResourceId,
  type NormalizedCapability,
  P,
  PermissionActor,
  PermissionContext,
  PermissionDeniedError,
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError,
  permissionAuditEvent,
  ResourceRegistry,
  type ResourceRegistryApi
} from "@orika/core"
import { Clock, Context, Effect, Layer, PubSub, Ref, Schema, Semaphore, Stream } from "effect"

import {
  ResidentLifecycleDisableRequest,
  ResidentLifecycleEnableRequest,
  ResidentLifecycleEvent,
  type ResidentLifecycleHandle,
  ResidentLifecycleState,
  ResidentLifecycleSupportedResult
} from "./contracts/resident-lifecycle.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

export * from "./contracts/resident-lifecycle.js"

const Surface = "ResidentLifecycle"
const UnsupportedReason = "host-adapter-unimplemented"
const EventMethod = "ResidentLifecycle.Event"
const ResourceId = makeResourceId("resident-lifecycle-policy")
const ResidentLifecycleSupport = NativeSurface.support.supported

export type ResidentLifecycleError = HostProtocolError

export const ResidentLifecycleEnable = residentLifecycleRpc(
  "enable",
  ResidentLifecycleEnableRequest,
  ResidentLifecycleState,
  P.nativeInvoke({ primitive: Surface, methods: ["enable"] })
)
export const ResidentLifecycleDisable = residentLifecycleRpc(
  "disable",
  ResidentLifecycleDisableRequest,
  ResidentLifecycleState,
  P.nativeInvoke({ primitive: Surface, methods: ["disable"] })
)
export const ResidentLifecycleGetState = NativeSurface.rpc(Surface, "getState", {
  payload: Schema.Void,
  success: ResidentLifecycleState,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: ResidentLifecycleSupport
})
export const ResidentLifecycleIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: ResidentLifecycleSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const ResidentLifecycleRpcEvents = Object.freeze({
  Event: { payload: ResidentLifecycleEvent }
})

const ResidentLifecycleRpcGroup = RpcGroup.make(
  ResidentLifecycleEnable,
  ResidentLifecycleDisable,
  ResidentLifecycleGetState,
  ResidentLifecycleIsSupported
)

export type ResidentLifecycleRpc = RpcGroup.Rpcs<typeof ResidentLifecycleRpcGroup>
export type ResidentLifecycleRpcHandlers<R = never> = NativeRpcHandlers<
  typeof ResidentLifecycleRpcGroup,
  R
>
export const ResidentLifecycleRpcs: RpcGroup.RpcGroup<ResidentLifecycleRpc> =
  ResidentLifecycleRpcGroup

export const ResidentLifecycleMethodNames = Object.freeze([
  "enable",
  "disable",
  "getState",
  "isSupported"
] as const)

const ResidentLifecycleCapabilityMethods = Object.freeze([
  "enable",
  "disable"
] as const satisfies readonly (typeof ResidentLifecycleMethodNames)[number][])

export interface ResidentLifecycleClientApi {
  readonly enable: (
    input: ResidentLifecycleEnableRequest
  ) => Effect.Effect<ResidentLifecycleState, ResidentLifecycleError, never>
  readonly disable: (
    input: ResidentLifecycleDisableRequest
  ) => Effect.Effect<ResidentLifecycleState, ResidentLifecycleError, never>
  readonly getState: () => Effect.Effect<ResidentLifecycleState, ResidentLifecycleError, never>
  readonly isSupported: () => Effect.Effect<
    ResidentLifecycleSupportedResult,
    ResidentLifecycleError,
    never
  >
  readonly events: () => Stream.Stream<ResidentLifecycleEvent, ResidentLifecycleError, never>
}

export class ResidentLifecycleClient extends Context.Service<
  ResidentLifecycleClient,
  ResidentLifecycleClientApi
>()("@orika/native/resident-lifecycle/ResidentLifecycleClient") {}

export interface ResidentLifecycleServiceApi extends ResidentLifecycleClientApi {}

export interface ResidentLifecycleServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly resources: ResourceRegistryApi
  readonly audit?: AuditEventsApi
}

interface ActiveResidentLifecycle {
  readonly handle: ResidentLifecycleHandle
  readonly generation: number
}

export class ResidentLifecycle extends Context.Service<
  ResidentLifecycle,
  ResidentLifecycleServiceApi
>()("@orika/native/resident-lifecycle/ResidentLifecycle") {
  static readonly layer = Layer.effect(ResidentLifecycle)(
    Effect.gen(function* () {
      const client = yield* ResidentLifecycleClient
      const permissions = yield* PermissionRegistry
      const resources = yield* ResourceRegistry
      return yield* makeResidentLifecycleService(client, { permissions, resources })
    })
  )
}

export const makeResidentLifecycleServiceLayer = (
  client: ResidentLifecycleClientApi,
  options: ResidentLifecycleServiceOptions
): Layer.Layer<ResidentLifecycle> =>
  Layer.effect(ResidentLifecycle)(makeResidentLifecycleService(client, options))

export const ResidentLifecycleHandlersLive = ResidentLifecycleRpcGroup.toLayer({
  "ResidentLifecycle.enable": (input) =>
    Effect.gen(function* () {
      const service = yield* ResidentLifecycle
      return yield* service.enable(input)
    }),
  "ResidentLifecycle.disable": (input) =>
    Effect.gen(function* () {
      const service = yield* ResidentLifecycle
      return yield* service.disable(input)
    }),
  "ResidentLifecycle.getState": () =>
    Effect.gen(function* () {
      const service = yield* ResidentLifecycle
      return yield* service.getState()
    }),
  "ResidentLifecycle.isSupported": () =>
    Effect.gen(function* () {
      const service = yield* ResidentLifecycle
      return yield* service.isSupported()
    })
})

export const ResidentLifecycleSurface = NativeSurface.make(Surface, ResidentLifecycleRpcGroup, {
  service: ResidentLifecycleClient,
  capabilities: ResidentLifecycleCapabilityMethods,
  handlers: ResidentLifecycleHandlersLive,
  client: (client) => residentLifecycleClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => residentLifecycleClientFromRpcClient(client, exchange)
})

export interface ResidentLifecycleMemoryClientOptions {
  readonly failure?: Partial<Record<"enable" | "disable", ResidentLifecycleError>>
}

export const makeResidentLifecycleMemoryClient = (
  options: ResidentLifecycleMemoryClientOptions = {}
): Effect.Effect<ResidentLifecycleClientApi, never, never> =>
  Effect.gen(function* () {
    const state = yield* Ref.make<ResidentLifecycleState>(
      new ResidentLifecycleState({ enabled: false })
    )
    const events = yield* PubSub.bounded<ResidentLifecycleEvent>({ capacity: 128, replay: 32 })

    return Object.freeze({
      enable: (input) =>
        validateEnable(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.enable,
              Effect.gen(function* () {
                const next = new ResidentLifecycleState({ enabled: true, policy: valid.policy })
                yield* Ref.set(state, next)
                yield* publishEvent(events, "enabled", next, valid.traceId ?? "resident-enable")
                return next
              })
            )
          )
        ),
      disable: (input) =>
        validateDisable(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.disable,
              Effect.gen(function* () {
                const next = new ResidentLifecycleState({ enabled: false })
                yield* Ref.set(state, next)
                yield* publishEvent(events, "disabled", next, valid.traceId ?? "resident-disable")
                return next
              })
            )
          )
        ),
      getState: () => Ref.get(state),
      isSupported: () => Effect.succeed(new ResidentLifecycleSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(events)
    } satisfies ResidentLifecycleClientApi)
  })

export const makeResidentLifecycleUnsupportedClient = (): ResidentLifecycleClientApi =>
  Object.freeze({
    enable: (input) =>
      validateEnable(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ResidentLifecycle.enable")))
      ),
    disable: (input) =>
      validateDisable(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ResidentLifecycle.disable")))
      ),
    getState: () => Effect.fail(unsupportedError("ResidentLifecycle.getState")),
    isSupported: () =>
      Effect.succeed(
        new ResidentLifecycleSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError("ResidentLifecycle.events"))
  } satisfies ResidentLifecycleClientApi)

const makeResidentLifecycleService = (
  client: ResidentLifecycleClientApi,
  options: ResidentLifecycleServiceOptions
): Effect.Effect<ResidentLifecycleServiceApi, never, never> =>
  Effect.gen(function* () {
    const handle = yield* Ref.make<ActiveResidentLifecycle | undefined>(undefined)
    const nextGeneration = yield* Ref.make(0)
    const lifecycle = yield* Semaphore.make(1)
    return Object.freeze({
      enable: (input) =>
        lifecycle.withPermits(1)(enableResident(client, options, handle, nextGeneration, input)),
      disable: (input) => lifecycle.withPermits(1)(disableResident(client, options, handle, input)),
      getState: () => client.getState(),
      isSupported: () => client.isSupported(),
      events: () => client.events()
    } satisfies ResidentLifecycleServiceApi)
  })

const enableResident = (
  client: ResidentLifecycleClientApi,
  options: ResidentLifecycleServiceOptions,
  currentHandle: Ref.Ref<ActiveResidentLifecycle | undefined>,
  nextGeneration: Ref.Ref<number>,
  input: unknown
): Effect.Effect<ResidentLifecycleState, ResidentLifecycleError, never> =>
  Effect.gen(function* () {
    const request = yield* validateEnable(input)
    yield* authorize(options, "enable", request.traceId)
    const existing = yield* Ref.get(currentHandle)
    if (existing !== undefined) {
      return yield* Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "policy",
          "resident lifecycle policy is already enabled",
          "ResidentLifecycle.enable"
        )
      )
    }
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const generation = yield* Ref.getAndUpdate(nextGeneration, (value) => value + 1)
        const handle = yield* options.resources
          .register({
            kind: "resident-lifecycle-policy",
            id: ResourceId,
            ownerScope: request.ownerScope ?? "app",
            state: "enabled",
            reusableId: true,
            dispose: Effect.suspend(() =>
              cleanupResidentLifecycle(client, currentHandle, generation, "scope-close")
            )
          })
          .pipe(
            Effect.mapError((error) =>
              makeHostProtocolInvalidArgumentError(
                error.field,
                error.message,
                "ResidentLifecycle.enable"
              )
            )
          )
        yield* Ref.set(currentHandle, { generation, handle })
        const disposeHandle = options.resources.dispose(handle.id).pipe(Effect.ignore)
        const state = yield* client.enable(request).pipe(
          Effect.tapError((error) =>
            emitLifecycleFailureAudit(options, "enable", request.traceId, error)
          ),
          Effect.tapError(() => disposeHandle)
        )
        yield* emitLifecycleAudit(options, "enabled", capability("enable"), request.traceId).pipe(
          Effect.tapError(() => disposeHandle)
        )
        return state
      })
    )
  })

const disableResident = (
  client: ResidentLifecycleClientApi,
  options: ResidentLifecycleServiceOptions,
  currentHandle: Ref.Ref<ActiveResidentLifecycle | undefined>,
  input: unknown
): Effect.Effect<ResidentLifecycleState, ResidentLifecycleError, never> =>
  Effect.gen(function* () {
    const request = yield* validateDisable(input)
    yield* authorize(options, "disable", request.traceId)
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const handle = yield* Ref.getAndSet(currentHandle, undefined)
        const restoreHandle = handle === undefined ? Effect.void : Ref.set(currentHandle, handle)
        const state = yield* restore(client.disable(request)).pipe(
          Effect.tapError((error) =>
            emitLifecycleFailureAudit(options, "disable", request.traceId, error)
          ),
          Effect.tapError(() => restoreHandle),
          Effect.onInterrupt(() => restoreHandle)
        )
        if (handle !== undefined) {
          yield* emitLifecycleAudit(
            options,
            "disabled",
            capability("disable"),
            request.traceId
          ).pipe(Effect.ensuring(options.resources.dispose(handle.handle.id).pipe(Effect.ignore)))
          return state
        }
        yield* emitLifecycleAudit(options, "disabled", capability("disable"), request.traceId)
        return state
      })
    )
  })

const cleanupResidentLifecycle = (
  client: ResidentLifecycleClientApi,
  currentHandle: Ref.Ref<ActiveResidentLifecycle | undefined>,
  generation: number,
  traceId: string
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const handle = yield* Ref.get(currentHandle)
    if (handle?.generation !== generation) {
      return
    }
    yield* client.disable(new ResidentLifecycleDisableRequest({ traceId })).pipe(Effect.ignore)
    const current = yield* Ref.get(currentHandle)
    if (current?.generation === generation) {
      yield* Ref.set(currentHandle, undefined)
    }
  })

const residentLifecycleClientFromRpcClient = (
  client: DesktopRpcClient<ResidentLifecycleRpc>,
  exchange: BridgeClientExchange | undefined
): ResidentLifecycleClientApi =>
  Object.freeze({
    enable: (input) =>
      validateEnable(input).pipe(
        Effect.flatMap((valid) =>
          runResidentRpc(client["ResidentLifecycle.enable"](valid), "ResidentLifecycle.enable")
        )
      ),
    disable: (input) =>
      validateDisable(input).pipe(
        Effect.flatMap((valid) =>
          runResidentRpc(client["ResidentLifecycle.disable"](valid), "ResidentLifecycle.disable")
        )
      ),
    getState: () =>
      runResidentRpc(client["ResidentLifecycle.getState"](undefined), "ResidentLifecycle.getState"),
    isSupported: () =>
      runResidentRpc(
        client["ResidentLifecycle.isSupported"](undefined),
        "ResidentLifecycle.isSupported"
      ),
    events: () =>
      subscribeNativeEvent(exchange, EventMethod, ResidentLifecycleEvent).pipe(
        Stream.mapError((error) => error)
      )
  } satisfies ResidentLifecycleClientApi)

function residentLifecycleRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, cap: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(cap),
    endpoint: "mutation",
    support: ResidentLifecycleSupport
  })
}

const validateEnable = (
  input: unknown
): Effect.Effect<ResidentLifecycleEnableRequest, HostProtocolError, never> =>
  decodeNativeInput(ResidentLifecycleEnableRequest, input, "ResidentLifecycle.enable")

const validateDisable = (
  input: unknown
): Effect.Effect<ResidentLifecycleDisableRequest, HostProtocolError, never> =>
  decodeNativeInput(ResidentLifecycleDisableRequest, input, "ResidentLifecycle.disable")

const runResidentRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, ResidentLifecycleError, never> =>
  runNativeRpc(effect, operation, Surface).pipe(Effect.mapError((error) => error))

const authorize = (
  options: ResidentLifecycleServiceOptions,
  method: "enable" | "disable",
  traceId: string | undefined
): Effect.Effect<void, ResidentLifecycleError, never> =>
  options.permissions
    .check(
      capability(method),
      new PermissionContext({
        actor: new PermissionActor({ kind: "app", id: "app" }),
        resource: "resident-lifecycle",
        traceId: traceId ?? `ResidentLifecycle.${method}`
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.tapError((error) =>
        error instanceof PermissionDeniedError
          ? emitPermissionDeniedAudit(options, method, error)
          : Effect.void
      ),
      Effect.mapError((error: PermissionRegistryError): ResidentLifecycleError => {
        if (error instanceof PermissionDeniedError) {
          return new HostProtocolPermissionDeniedError({
            tag: "PermissionDenied",
            message: `permission denied for ${capability(method).kind}`,
            operation: `ResidentLifecycle.${method}`,
            capability: capability(method).kind,
            resource: error.traceId,
            recoverable: false
          })
        }
        return makeHostProtocolInternalError(
          `resident lifecycle permission failure: ${error._tag}`,
          `ResidentLifecycle.${method}`
        )
      })
    )

const emitPermissionDeniedAudit = (
  options: ResidentLifecycleServiceOptions,
  method: "enable" | "disable",
  error: PermissionDeniedError
): Effect.Effect<void, never, never> =>
  emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-denied",
      source: `ResidentLifecycle.${method}`,
      traceId: error.traceId,
      outcome: "denied",
      normalizedCapability: capability(method),
      actor: new PermissionActor({ kind: "app", id: "app" }),
      resource: "resident-lifecycle",
      details: { reason: error.reason }
    })
  ).pipe(Effect.ignore)

const emitLifecycleAudit = (
  options: ResidentLifecycleServiceOptions,
  outcome: string,
  cap: NormalizedCapability,
  traceId: string | undefined,
  details: Record<string, string> = {}
): Effect.Effect<void, ResidentLifecycleError, never> =>
  emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-used",
      source: "ResidentLifecycle",
      traceId: traceId ?? "resident-lifecycle",
      outcome,
      normalizedCapability: cap,
      actor: new PermissionActor({ kind: "app", id: "app" }),
      resource: "resident-lifecycle",
      details: { surface: "resident-lifecycle", ...details }
    })
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInternalError(
        `failed to write resident lifecycle audit event: ${error.message}`,
        "ResidentLifecycle.audit"
      )
    )
  )

const emitLifecycleFailureAudit = (
  options: ResidentLifecycleServiceOptions,
  method: "enable" | "disable",
  traceId: string | undefined,
  error: ResidentLifecycleError
): Effect.Effect<void, never, never> =>
  emitLifecycleAudit(options, "failed", capability(method), traceId, {
    reason: error.tag,
    operation: error.operation
  }).pipe(Effect.ignore)

const publishEvent = (
  events: PubSub.PubSub<ResidentLifecycleEvent>,
  phase: "enabled" | "disabled",
  state: ResidentLifecycleState,
  traceId: string
): Effect.Effect<void, never, never> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((timestamp) =>
      PubSub.publish(
        events,
        new ResidentLifecycleEvent({
          type: "resident-lifecycle-event",
          timestamp,
          phase,
          state,
          traceId
        })
      )
    ),
    Effect.asVoid
  )

const capability = (method: "enable" | "disable"): NormalizedCapability =>
  P.nativeInvoke({ primitive: Surface, methods: [method] })

const failOr = <A>(
  error: ResidentLifecycleError | undefined,
  effect: Effect.Effect<A, never, never>
): Effect.Effect<A, ResidentLifecycleError, never> =>
  error === undefined ? effect : Effect.fail(error)

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported ResidentLifecycle method: ${operation}`,
    operation,
    recoverable: false
  })
